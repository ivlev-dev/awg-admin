use std::collections::VecDeque;
use std::sync::{Arc, Mutex, OnceLock};

use anyhow::{Context, Result, bail};
use lettre::message::Mailbox;
use lettre::transport::smtp::AsyncSmtpTransport;
use lettre::transport::smtp::authentication::Credentials;
use lettre::transport::smtp::client::{Tls, TlsParameters};
use lettre::{AsyncTransport, Message, Tokio1Executor};

use awg_identity::{Mailer, MailerFuture};
use awg_shared::CoreError;

use crate::config::{Config, MailMode};

pub const DEV_MAILBOX_CAPACITY: usize = 50;
pub const VERIFICATION_SUBJECT: &str = "Подтверждение email";
pub const PASSWORD_RESET_SUBJECT: &str = "Сброс пароля";

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

    fn verification_body(link: &str, app_link: Option<&str>) -> String {
        match app_link {
            Some(app_link) => format!(
                "Для подтверждения email перейдите по ссылке: {link}\nСсылка для приложения Umbra VPN: {app_link}"
            ),
            None => format!("Для подтверждения email перейдите по ссылке: {link}"),
        }
    }

    fn password_reset_body(link: &str) -> String {
        format!(
            "Для сброса пароля перейдите по ссылке: {link}\nСсылка действует 1 час. Если вы не запрашивали сброс пароля, проигнорируйте это письмо."
        )
    }
}

impl Mailer for LogMailer {
    fn send_verification<'a>(&'a self, email: &'a str, link: &'a str) -> MailerFuture<'a> {
        self.send_verification_with_app(email, link, None)
    }

    fn send_verification_with_app<'a>(
        &'a self,
        email: &'a str,
        link: &'a str,
        app_link: Option<&'a str>,
    ) -> MailerFuture<'a> {
        Box::pin(async move {
            if self.log_links {
                tracing::info!(%email, %link, app_link = app_link.unwrap_or(""), "verification email (log mailer)");
            } else {
                tracing::info!(%email, "verification email (log mailer)");
            }
            if let Some(mailbox) = &self.dev_mailbox {
                mailbox.push(DevMail {
                    to: email.to_string(),
                    subject: VERIFICATION_SUBJECT.to_string(),
                    link: link.to_string(),
                    body: Self::verification_body(link, app_link),
                    created_at: chrono::Utc::now().to_rfc3339(),
                });
            }
            Ok(())
        })
    }

    fn send_password_reset<'a>(&'a self, email: &'a str, link: &'a str) -> MailerFuture<'a> {
        Box::pin(async move {
            if self.log_links {
                tracing::info!(%email, %link, "password reset email (log mailer)");
            } else {
                tracing::info!(%email, "password reset email (log mailer)");
            }
            if let Some(mailbox) = &self.dev_mailbox {
                mailbox.push(DevMail {
                    to: email.to_string(),
                    subject: PASSWORD_RESET_SUBJECT.to_string(),
                    link: link.to_string(),
                    body: Self::password_reset_body(link),
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SmtpSecurity {
    /// `smtp://`: a plaintext connection that must be upgraded with STARTTLS.
    StartTls,
    /// `smtps://`: TLS from the first byte (implicit TLS, usually port 465).
    ImplicitTls,
}

impl SmtpSecurity {
    fn default_port(self) -> u16 {
        match self {
            SmtpSecurity::StartTls => 587,
            SmtpSecurity::ImplicitTls => 465,
        }
    }
}

/// A parsed `AWG_SMTP_URL`. Kept separate from the lettre transport so the URL
/// contract (scheme, default port, credentials) can be tested without opening a
/// network connection.
#[derive(Debug, Clone, PartialEq, Eq)]
struct SmtpEndpoint {
    host: String,
    port: u16,
    security: SmtpSecurity,
    username: Option<String>,
    password: Option<String>,
}

impl SmtpEndpoint {
    fn parse(url: &str) -> Result<Self> {
        let parsed = url::Url::parse(url).context("AWG_SMTP_URL is invalid")?;
        let security = match parsed.scheme() {
            "smtp" => SmtpSecurity::StartTls,
            "smtps" => SmtpSecurity::ImplicitTls,
            other => bail!(
                "AWG_SMTP_URL must use the smtp:// (STARTTLS) or smtps:// (implicit TLS) scheme, got {other:?}"
            ),
        };
        let host = parsed
            .host_str()
            .filter(|host| !host.is_empty())
            .context("AWG_SMTP_URL has no host")?
            .to_string();
        let port = parsed.port().unwrap_or_else(|| security.default_port());
        let (username, password) = if parsed.username().is_empty() {
            (None, None)
        } else {
            (
                Some(percent_decode(parsed.username())),
                Some(percent_decode(parsed.password().unwrap_or_default())),
            )
        };
        Ok(Self {
            host,
            port,
            security,
            username,
            password,
        })
    }

    fn tls_parameters(&self) -> Result<TlsParameters> {
        TlsParameters::new(self.host.clone())
            .map_err(|error| anyhow::anyhow!("AWG_SMTP_URL TLS setup failed: {error}"))
    }

    fn into_transport(self) -> Result<AsyncSmtpTransport<Tokio1Executor>> {
        let parameters = self.tls_parameters()?;
        let tls = match self.security {
            // STARTTLS is mandatory: lettre aborts the connection if the
            // server does not offer an upgrade, so credentials and mail never
            // travel in plaintext.
            SmtpSecurity::StartTls => Tls::Required(parameters),
            SmtpSecurity::ImplicitTls => Tls::Wrapper(parameters),
        };
        let mut builder = AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&self.host)
            .port(self.port)
            .tls(tls);
        if let Some(username) = self.username {
            builder = builder.credentials(Credentials::new(
                username,
                self.password.unwrap_or_default(),
            ));
        }
        Ok(builder.build())
    }
}

impl SmtpMailer {
    pub fn from_url(url: &str, from: &str) -> Result<Self> {
        let transport = SmtpEndpoint::parse(url)?.into_transport()?;
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
        self.send_verification_with_app(email, link, None)
    }

    fn send_verification_with_app<'a>(
        &'a self,
        email: &'a str,
        link: &'a str,
        app_link: Option<&'a str>,
    ) -> MailerFuture<'a> {
        Box::pin(async move {
            let to: Mailbox = email
                .parse()
                .map_err(|e| CoreError::Invalid(format!("invalid recipient email: {e}")))?;
            let message = Message::builder()
                .from(self.from.clone())
                .to(to)
                .subject(VERIFICATION_SUBJECT)
                .body(LogMailer::verification_body(link, app_link))
                .map_err(|e| CoreError::Io(std::io::Error::other(e.to_string())))?;
            self.transport
                .send(message)
                .await
                .map_err(|e| CoreError::Io(std::io::Error::other(e.to_string())))?;
            Ok(())
        })
    }

    fn send_password_reset<'a>(&'a self, email: &'a str, link: &'a str) -> MailerFuture<'a> {
        Box::pin(async move {
            let to: Mailbox = email
                .parse()
                .map_err(|e| CoreError::Invalid(format!("invalid recipient email: {e}")))?;
            let message = Message::builder()
                .from(self.from.clone())
                .to(to)
                .subject(PASSWORD_RESET_SUBJECT)
                .body(LogMailer::password_reset_body(link))
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
            body: LogMailer::verification_body("http://localhost/verify-email", None),
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
    async fn log_mailer_stores_app_verification_link_in_development() {
        let mailbox = Arc::new(DevMailbox::new());
        let mailer = LogMailer {
            dev_mailbox: Some(mailbox.clone()),
            log_links: true,
        };
        mailer
            .send_verification_with_app(
                "dev@example.com",
                "https://panel.example.com/verify-email?token=abc",
                Some("umbravpn://verify?token=abc"),
            )
            .await
            .unwrap();
        let messages = mailbox.list();
        assert_eq!(
            messages[0].link,
            "https://panel.example.com/verify-email?token=abc"
        );
        assert!(messages[0].body.contains("umbravpn://verify?token=abc"));
        assert!(
            messages[0]
                .body
                .contains("https://panel.example.com/verify-email?token=abc")
        );
    }

    #[tokio::test]
    async fn log_mailer_stores_password_reset_messages_in_development() {
        let mailbox = Arc::new(DevMailbox::new());
        let mailer = LogMailer {
            dev_mailbox: Some(mailbox.clone()),
            log_links: true,
        };
        mailer
            .send_password_reset(
                "dev@example.com",
                "http://localhost/reset-password?token=reset-abc",
            )
            .await
            .unwrap();
        let messages = mailbox.list();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].to, "dev@example.com");
        assert_eq!(messages[0].subject, PASSWORD_RESET_SUBJECT);
        assert!(messages[0].link.ends_with("token=reset-abc"));
        assert!(messages[0].body.contains("Ссылка действует 1 час"));
    }

    #[tokio::test]
    async fn log_mailer_does_not_store_password_resets_in_production() {
        let mailbox = Arc::new(DevMailbox::new());
        let mailer = LogMailer {
            dev_mailbox: None,
            log_links: false,
        };
        mailer
            .send_password_reset(
                "prod@example.com",
                "http://localhost/reset-password?token=abc",
            )
            .await
            .unwrap();
        assert!(mailbox.is_empty());
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

    #[test]
    fn smtps_url_uses_implicit_tls_and_port_465() {
        let endpoint = SmtpEndpoint::parse("smtps://mail.example.com").unwrap();
        assert_eq!(endpoint.host, "mail.example.com");
        assert_eq!(endpoint.port, 465);
        assert_eq!(endpoint.security, SmtpSecurity::ImplicitTls);
        assert!(endpoint.username.is_none());

        let explicit = SmtpEndpoint::parse("smtps://mail.example.com:2465").unwrap();
        assert_eq!(explicit.port, 2465);
        assert_eq!(explicit.security, SmtpSecurity::ImplicitTls);
    }

    #[test]
    fn smtp_url_requires_starttls_and_defaults_to_port_587() {
        let endpoint = SmtpEndpoint::parse("smtp://mail.example.com").unwrap();
        assert_eq!(endpoint.host, "mail.example.com");
        assert_eq!(endpoint.port, 587);
        assert_eq!(endpoint.security, SmtpSecurity::StartTls);

        let explicit = SmtpEndpoint::parse("smtp://mail.example.com:2525").unwrap();
        assert_eq!(explicit.port, 2525);
    }

    #[test]
    fn smtp_url_rejects_other_schemes() {
        for url in [
            "http://mail.example.com",
            "smtp+starttls://mail.example.com",
            "mail.example.com:587",
        ] {
            let error = SmtpEndpoint::parse(url).unwrap_err().to_string();
            assert!(error.contains("AWG_SMTP_URL"), "{url}: {error}");
        }
    }

    #[test]
    fn smtp_url_decodes_credentials() {
        let endpoint =
            SmtpEndpoint::parse("smtp://user%40example.com:p%40ss%3Aword@mail.example.com")
                .unwrap();
        assert_eq!(endpoint.username.as_deref(), Some("user@example.com"));
        assert_eq!(endpoint.password.as_deref(), Some("p@ss:word"));
    }

    #[tokio::test]
    async fn smtp_mailer_builds_starttls_transport() {
        let mailer = SmtpMailer::from_url("smtp://mail.example.com", "panel@example.com").unwrap();
        assert_eq!(mailer.from.to_string(), "panel@example.com");
    }

    #[tokio::test]
    async fn smtp_mailer_builds_implicit_tls_transport() {
        let mailer = SmtpMailer::from_url("smtps://mail.example.com", "panel@example.com").unwrap();
        assert_eq!(mailer.from.to_string(), "panel@example.com");
    }

    #[tokio::test]
    async fn smtp_mailer_rejects_bad_schemes_and_senders() {
        assert!(SmtpMailer::from_url("http://mail.example.com", "panel@example.com").is_err());
        assert!(SmtpMailer::from_url("smtp://mail.example.com", "not-an-email").is_err());
    }
}
