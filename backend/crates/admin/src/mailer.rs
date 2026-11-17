use std::collections::VecDeque;
use std::sync::{Arc, Mutex, OnceLock};

use anyhow::{Context, Result, bail};
use lettre::message::Mailbox;
use lettre::transport::smtp::AsyncSmtpTransport;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncTransport, Message, Tokio1Executor};

use awg_identity::{Mailer, MailerFuture};
use awg_shared::CoreError;

use crate::config::{Config, MailMode};

pub const DEV_MAILBOX_CAPACITY: usize = 50;
pub const VERIFICATION_SUBJECT: &str = "Подтверждение email";

#[derive(Debug, Clone, serde::Serialize)]
pub struct DevMail {
    pub to: String,
    pub subject: String,
    pub link: String,
    pub body: String,
    pub created_at: String,
}

#[derive(Debug)]
pub struct DevMailbox {
    messages: Mutex<VecDeque<DevMail>>,
}

impl Default for DevMailbox {
    fn default() -> Self {
        Self::new()
    }
}

impl DevMailbox {
    pub fn new() -> Self {
        Self {
            messages: Mutex::new(VecDeque::with_capacity(DEV_MAILBOX_CAPACITY)),
        }
    }

    pub fn push(&self, mail: DevMail) {
        let mut messages = self.messages.lock().unwrap_or_else(|e| e.into_inner());
        while messages.len() >= DEV_MAILBOX_CAPACITY {
            messages.pop_front();
        }
        messages.push_back(mail);
    }

    pub fn list(&self) -> Vec<DevMail> {
        let messages = self.messages.lock().unwrap_or_else(|e| e.into_inner());
        messages.iter().cloned().collect()
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        let messages = self.messages.lock().unwrap_or_else(|e| e.into_inner());
        messages.len()
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn clear(&self) {
        let mut messages = self.messages.lock().unwrap_or_else(|e| e.into_inner());
        messages.clear();
    }
}

static DEV_MAILBOX: OnceLock<Arc<DevMailbox>> = OnceLock::new();

pub fn dev_mailbox() -> Arc<DevMailbox> {
    DEV_MAILBOX
        .get_or_init(|| Arc::new(DevMailbox::new()))
        .clone()
}

pub struct LogMailer {
    dev_mailbox: Option<Arc<DevMailbox>>,
    log_links: bool,
}

impl LogMailer {
    pub fn new(development: bool) -> Self {
        Self {
            dev_mailbox: development.then(dev_mailbox),
            log_links: development,
        }
    }

    fn verification_body(link: &str) -> String {
        format!("Для подтверждения email перейдите по ссылке: {link}")
    }
}

impl Mailer for LogMailer {
    fn send_verification<'a>(&'a self, email: &'a str, link: &'a str) -> MailerFuture<'a> {
        Box::pin(async move {
            if self.log_links {
                tracing::info!(%email, %link, "verification email (log mailer)");
            } else {
                tracing::info!(%email, "verification email (log mailer)");
            }
            if let Some(mailbox) = &self.dev_mailbox {
                mailbox.push(DevMail {
                    to: email.to_string(),
                    subject: VERIFICATION_SUBJECT.to_string(),
                    link: link.to_string(),
                    body: Self::verification_body(link),
                    created_at: chrono::Utc::now().to_rfc3339(),
                });
            }
            Ok(())
        })
    }
}

pub struct SmtpMailer {
    transport: AsyncSmtpTransport<Tokio1Executor>,
    from: Mailbox,
}

impl SmtpMailer {
    pub fn from_url(url: &str, from: &str) -> Result<Self> {
        let parsed = url::Url::parse(url).context("AWG_SMTP_URL is invalid")?;
        if parsed.scheme() != "smtp" {
            bail!("AWG_SMTP_URL must use the smtp:// scheme");
        }
        let host = parsed.host_str().context("AWG_SMTP_URL has no host")?;
        let mut builder = AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(host)
            .port(parsed.port().unwrap_or(25));
        if !parsed.username().is_empty() {
            builder = builder.credentials(Credentials::new(
                percent_decode(parsed.username()),
                percent_decode(parsed.password().unwrap_or_default()),
            ));
        }
        let transport = builder.build();
        let from: Mailbox = from
            .parse()
            .context("AWG_SMTP_FROM must be a valid email address")?;
        Ok(Self { transport, from })
    }
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%'
            && index + 2 < bytes.len()
            && let (Some(high), Some(low)) =
                (hex_value(bytes[index + 1]), hex_value(bytes[index + 2]))
        {
            out.push(high * 16 + low);
            index += 3;
            continue;
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

impl Mailer for SmtpMailer {
    fn send_verification<'a>(&'a self, email: &'a str, link: &'a str) -> MailerFuture<'a> {
        Box::pin(async move {
            let to: Mailbox = email
                .parse()
                .map_err(|e| CoreError::Invalid(format!("invalid recipient email: {e}")))?;
            let message = Message::builder()
                .from(self.from.clone())
                .to(to)
                .subject(VERIFICATION_SUBJECT)
                .body(format!(
                    "Для подтверждения email перейдите по ссылке: {link}"
                ))
                .map_err(|e| CoreError::Io(std::io::Error::other(e.to_string())))?;
            self.transport
                .send(message)
                .await
                .map_err(|e| CoreError::Io(std::io::Error::other(e.to_string())))?;
            Ok(())
        })
    }
}

pub fn build_mailer(config: &Config) -> Result<Arc<dyn Mailer>> {
    match config.mail_mode {
        MailMode::Log => Ok(Arc::new(LogMailer::new(
            !config.environment.is_production(),
        ))),
        MailMode::Smtp => {
            let url = config
                .smtp_url
                .as_deref()
                .context("AWG_SMTP_URL is required when AWG_MAIL_MODE=smtp")?;
            let from = config
                .smtp_from
                .as_deref()
                .context("AWG_SMTP_FROM is required when AWG_MAIL_MODE=smtp")?;
            Ok(Arc::new(SmtpMailer::from_url(url, from)?))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mail(index: usize) -> DevMail {
        DevMail {
            to: format!("user{index}@example.com"),
            subject: VERIFICATION_SUBJECT.to_string(),
            link: format!("http://localhost/verify-email?token=token-{index}"),
            body: LogMailer::verification_body("http://localhost/verify-email"),
            created_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn dev_mailbox_is_bounded_and_keeps_latest() {
        let mailbox = DevMailbox::new();
        for index in 0..DEV_MAILBOX_CAPACITY + 7 {
            mailbox.push(mail(index));
        }
        assert_eq!(mailbox.len(), DEV_MAILBOX_CAPACITY);
        let messages = mailbox.list();
        assert_eq!(messages.first().unwrap().to, "user7@example.com");
        assert_eq!(
            messages.last().unwrap().to,
            format!("user{}@example.com", DEV_MAILBOX_CAPACITY + 6)
        );
    }

    #[test]
    fn dev_mailbox_clear_removes_messages() {
        let mailbox = DevMailbox::new();
        mailbox.push(mail(1));
        mailbox.clear();
        assert!(mailbox.is_empty());
    }

    #[tokio::test]
    async fn log_mailer_stores_messages_in_development() {
        let mailbox = Arc::new(DevMailbox::new());
        let mailer = LogMailer {
            dev_mailbox: Some(mailbox.clone()),
            log_links: true,
        };
        mailer
            .send_verification("dev@example.com", "http://localhost/verify-email?token=abc")
            .await
            .unwrap();
        let messages = mailbox.list();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].to, "dev@example.com");
        assert_eq!(messages[0].subject, VERIFICATION_SUBJECT);
        assert!(messages[0].link.ends_with("token=abc"));
    }

    #[tokio::test]
    async fn log_mailer_does_not_store_messages_in_production() {
        let mailbox = Arc::new(DevMailbox::new());
        let mailer = LogMailer {
            dev_mailbox: None,
            log_links: false,
        };
        mailer
            .send_verification(
                "prod@example.com",
                "http://localhost/verify-email?token=abc",
            )
            .await
            .unwrap();
        assert!(mailbox.is_empty());
    }
}
