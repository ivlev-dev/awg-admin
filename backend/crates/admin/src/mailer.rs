use std::sync::Arc;

use anyhow::{Context, Result, bail};
use lettre::message::Mailbox;
use lettre::transport::smtp::AsyncSmtpTransport;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncTransport, Message, Tokio1Executor};

use awg_identity::{Mailer, MailerFuture};
use awg_shared::CoreError;

use crate::config::{Config, MailMode};

pub struct LogMailer;

impl Mailer for LogMailer {
    fn send_verification<'a>(&'a self, email: &'a str, link: &'a str) -> MailerFuture<'a> {
        Box::pin(async move {
            tracing::info!(%email, %link, "verification email (log mailer)");
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
                .subject("Подтверждение email")
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
        MailMode::Log => Ok(Arc::new(LogMailer)),
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
