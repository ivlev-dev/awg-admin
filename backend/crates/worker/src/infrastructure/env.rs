use std::net::IpAddr;

use anyhow::{Result, bail};

/// Boolean environment flags accept `1/true/yes/on` and `0/false/no/off`.
/// An unset variable is `false`; any other value is a startup error so a typo
/// (`AWG_DRY_RUN=ture`) does not silently change behaviour.
pub fn env_flag(key: &str) -> Result<bool> {
    match std::env::var(key) {
        Ok(value) => parse_flag(key, &value),
        Err(std::env::VarError::NotPresent) => Ok(false),
        Err(std::env::VarError::NotUnicode(_)) => bail!("{key} must be valid UTF-8"),
    }
}

pub fn parse_flag(key: &str, value: &str) -> Result<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Ok(true),
        "0" | "false" | "no" | "off" => Ok(false),
        "" => bail!("{key} is set but empty; expected 1/true/yes/on or 0/false/no/off"),
        other => {
            bail!("{key}={other:?} is not a boolean; expected 1/true/yes/on or 0/false/no/off")
        }
    }
}

/// Extract the host part of an `http(s)://host[:port]` URL without pulling in
/// a full URL parser (the URL is validated later by tonic).
pub fn url_host(url: &str) -> Option<String> {
    let rest = url.split_once("://").map(|(_, rest)| rest).unwrap_or(url);
    let authority = rest.split(['/', '?', '#']).next()?;
    let authority = authority
        .rsplit_once('@')
        .map_or(authority, |(_, host)| host);
    if authority.is_empty() {
        return None;
    }
    if let Some(stripped) = authority.strip_prefix('[') {
        return stripped
            .split_once(']')
            .map(|(host, _)| host.to_string())
            .filter(|host| !host.is_empty());
    }
    let host = authority.split(':').next()?;
    (!host.is_empty()).then(|| host.to_string())
}

pub fn is_loopback_host(host: &str) -> bool {
    let host = host.trim_matches(|ch| ch == '[' || ch == ']');
    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<IpAddr>()
            .map(|address| address.is_loopback())
            .unwrap_or(false)
}

/// `true` when the URL points anywhere except loopback, including URLs that
/// cannot be parsed (those deserve a warning as well).
pub fn url_is_remote(url: &str) -> bool {
    match url_host(url) {
        Some(host) => !is_loopback_host(&host),
        None => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_accept_documented_spellings() {
        for value in ["1", "true", "TRUE", "yes", "On", " true "] {
            assert!(parse_flag("X", value).unwrap(), "{value}");
        }
        for value in ["0", "false", "No", "off", " off "] {
            assert!(!parse_flag("X", value).unwrap(), "{value}");
        }
    }

    #[test]
    fn unknown_flag_value_is_an_error() {
        let error = parse_flag("AWG_DRY_RUN", "ture").unwrap_err().to_string();
        assert!(error.contains("AWG_DRY_RUN"), "{error}");
        assert!(parse_flag("AWG_DRY_RUN", "").is_err());
    }

    #[test]
    fn extracts_hosts_from_urls() {
        assert_eq!(
            url_host("http://127.0.0.1:9090").as_deref(),
            Some("127.0.0.1")
        );
        assert_eq!(
            url_host("https://admin.example.com/v1").as_deref(),
            Some("admin.example.com")
        );
        assert_eq!(url_host("http://[::1]:9090").as_deref(), Some("::1"));
        assert_eq!(
            url_host("http://worker:token@10.0.0.5:9090").as_deref(),
            Some("10.0.0.5")
        );
        assert_eq!(url_host(""), None);
    }

    #[test]
    fn detects_loopback_targets() {
        assert!(!url_is_remote("http://127.0.0.1:9090"));
        assert!(!url_is_remote("http://localhost:9090"));
        assert!(!url_is_remote("http://[::1]:9090"));
        assert!(url_is_remote("https://admin.example.com"));
        assert!(url_is_remote("http://10.0.0.5:9090"));
        assert!(url_is_remote("not a url"));
    }
}
