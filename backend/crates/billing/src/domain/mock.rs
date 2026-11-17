use chrono::{DateTime, Utc};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use uuid::Uuid;

use super::gateway::{
    ChargeRequest, ChargeResult, CheckoutRequest, CheckoutSession, GatewayError, PaymentEvent,
    PaymentEventKind, PaymentGateway, PaymentMethodInfo, RefundRequest, RefundResult,
    WebhookRequest,
};

pub const MOCK_TIMESTAMP_HEADER: &str = "x-mock-timestamp";
pub const MOCK_SIGNATURE_HEADER: &str = "x-mock-signature";
pub const DEFAULT_MOCK_TOLERANCE_SECS: i64 = 300;
const MIN_SECRET_LEN: usize = 32;

#[derive(Debug, Clone)]
pub struct MockGateway {
    secret: Vec<u8>,
    base_url: String,
    tolerance_secs: i64,
}

impl MockGateway {
    pub fn new(
        secret: impl Into<Vec<u8>>,
        base_url: impl Into<String>,
        tolerance_secs: i64,
    ) -> Self {
        let base_url = base_url.into().trim_end_matches('/').to_string();
        Self {
            secret: secret.into(),
            base_url,
            tolerance_secs: tolerance_secs.max(1),
        }
    }

    pub fn from_config(
        secret: &str,
        base_url: &str,
        tolerance_secs: i64,
    ) -> Result<Self, GatewayError> {
        if secret.len() < MIN_SECRET_LEN {
            return Err(GatewayError::Invalid(format!(
                "mock payment secret must be at least {MIN_SECRET_LEN} characters"
            )));
        }
        let base_url = if base_url.trim().is_empty() {
            "http://localhost".to_string()
        } else {
            base_url.trim().trim_end_matches('/').to_string()
        };
        Ok(Self::new(secret.as_bytes(), base_url, tolerance_secs))
    }

    pub fn provider_name(&self) -> &'static str {
        "mock"
    }
}

impl PaymentGateway for MockGateway {
    fn provider_name(&self) -> &'static str {
        MockGateway::provider_name(self)
    }

    fn create_checkout(&self, request: CheckoutRequest) -> Result<CheckoutSession, GatewayError> {
        if request.amount_cents < 0 {
            return Err(GatewayError::Invalid(
                "checkout amount must not be negative".into(),
            ));
        }
        Ok(CheckoutSession {
            gateway_ref: format!("mock-chk-{}", request.invoice_id),
            url: format!("{}/pay/mock/{}", self.base_url, request.invoice_id),
        })
    }

    fn charge_recurring(&self, request: ChargeRequest) -> Result<ChargeResult, GatewayError> {
        if request.amount_cents < 0 {
            return Err(GatewayError::Invalid(
                "charge amount must not be negative".into(),
            ));
        }
        Ok(ChargeResult {
            gateway_ref: request
                .gateway_ref
                .unwrap_or_else(|| format!("mock-charge-{}", request.invoice_id)),
            paid: true,
        })
    }

    fn refund(&self, request: RefundRequest) -> Result<RefundResult, GatewayError> {
        if request.amount_cents <= 0 {
            return Err(GatewayError::Invalid(
                "refund amount must be positive".into(),
            ));
        }
        Ok(RefundResult {
            refund_ref: format!("mock-refund-{}", request.gateway_ref),
            amount_cents: request.amount_cents,
        })
    }

    fn verify_webhook(
        &self,
        request: &WebhookRequest,
        now: DateTime<Utc>,
    ) -> Result<(), GatewayError> {
        let raw_timestamp = request
            .header(MOCK_TIMESTAMP_HEADER)
            .ok_or_else(|| GatewayError::Invalid("missing mock timestamp header".into()))?;
        let timestamp = raw_timestamp
            .trim()
            .parse::<i64>()
            .map_err(|_| GatewayError::Invalid("mock timestamp header is not a number".into()))?;
        let signature = request
            .header(MOCK_SIGNATURE_HEADER)
            .ok_or_else(|| GatewayError::Invalid("missing mock signature header".into()))?;
        verify_mock_signature(
            &self.secret,
            self.tolerance_secs,
            now.timestamp(),
            timestamp,
            request.body.as_slice(),
            signature,
        )
    }

    fn parse_event(&self, request: &WebhookRequest) -> Result<PaymentEvent, GatewayError> {
        let payload: MockEventPayload = serde_json::from_slice(&request.body).map_err(|error| {
            GatewayError::Invalid(format!("malformed webhook payload: {error}"))
        })?;
        if payload.event_id.trim().is_empty() {
            return Err(GatewayError::Invalid("event_id is required".into()));
        }
        if payload.kind.trim().is_empty() {
            return Err(GatewayError::Invalid("kind is required".into()));
        }
        let payment_method = payload
            .payment_method
            .map(|method| PaymentMethodInfo {
                gateway_ref: method.gateway_ref,
                brand: method.brand.unwrap_or_else(|| "unknown".into()),
                last4: method.last4.unwrap_or_default(),
            })
            .map(|method| {
                if method.gateway_ref.trim().is_empty() {
                    Err(GatewayError::Invalid(
                        "payment method gateway_ref is required".into(),
                    ))
                } else {
                    Ok(method)
                }
            })
            .transpose()?;
        Ok(PaymentEvent {
            gateway: self.provider_name().to_string(),
            event_id: payload.event_id,
            kind: PaymentEventKind::parse(&payload.kind),
            invoice_id: payload.invoice_id,
            amount_cents: payload.amount_cents,
            currency: payload.currency,
            gateway_ref: payload.gateway_ref,
            payment_method,
        })
    }
}

#[derive(Debug, Deserialize)]
struct MockEventPayload {
    event_id: String,
    kind: String,
    #[serde(default)]
    invoice_id: Option<Uuid>,
    #[serde(default)]
    amount_cents: Option<i64>,
    #[serde(default)]
    currency: Option<String>,
    #[serde(default)]
    gateway_ref: Option<String>,
    #[serde(default)]
    payment_method: Option<MockPaymentMethod>,
}

#[derive(Debug, Deserialize)]
struct MockPaymentMethod {
    gateway_ref: String,
    #[serde(default)]
    brand: Option<String>,
    #[serde(default)]
    last4: Option<String>,
}

fn verify_mock_signature(
    secret: &[u8],
    tolerance_secs: i64,
    now: i64,
    timestamp: i64,
    body: &[u8],
    provided: &str,
) -> Result<(), GatewayError> {
    if now.abs_diff(timestamp) > tolerance_secs.unsigned_abs() {
        return Err(GatewayError::Invalid(
            "webhook timestamp is outside the tolerance window".into(),
        ));
    }
    let provided = decode_hex(provided.trim())
        .ok_or_else(|| GatewayError::Invalid("signature is not valid hex".into()))?;
    if provided.len() != 32 {
        return Err(GatewayError::Signature);
    }
    let expected = webhook_signature(secret, timestamp, body);
    if expected.ct_eq(provided.as_slice()).into() {
        Ok(())
    } else {
        Err(GatewayError::Signature)
    }
}

pub fn webhook_signature(secret: &[u8], timestamp: i64, body: &[u8]) -> [u8; 32] {
    let mut message = timestamp.to_string().into_bytes();
    message.push(b'.');
    message.extend_from_slice(body);
    hmac_sha256(secret, &message)
}

pub fn sign_webhook(secret: &str, timestamp: i64, body: &[u8]) -> String {
    encode_hex(&webhook_signature(secret.as_bytes(), timestamp, body))
}

pub fn payload_sha256(body: &[u8]) -> String {
    encode_hex(&Sha256::digest(body))
}

fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    const BLOCK: usize = 64;
    let mut key_block = [0u8; BLOCK];
    if key.len() > BLOCK {
        key_block[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        key_block[..key.len()].copy_from_slice(key);
    }
    let mut inner_pad = [0x36u8; BLOCK];
    let mut outer_pad = [0x5cu8; BLOCK];
    for index in 0..BLOCK {
        inner_pad[index] ^= key_block[index];
        outer_pad[index] ^= key_block[index];
    }
    let mut inner = Sha256::new();
    inner.update(inner_pad);
    inner.update(message);
    let inner = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner);
    outer.finalize().into()
}

fn encode_hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(DIGITS[(byte >> 4) as usize] as char);
        out.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    out
}

fn decode_hex(raw: &str) -> Option<Vec<u8>> {
    if !raw.len().is_multiple_of(2) {
        return None;
    }
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len() / 2);
    let mut index = 0;
    while index < bytes.len() {
        let high = hex_digit(bytes[index])?;
        let low = hex_digit(bytes[index + 1])?;
        out.push((high << 4) | low);
        index += 2;
    }
    Some(out)
}

fn hex_digit(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "mock-secret-that-is-at-least-32-chars-long";

    fn gateway() -> MockGateway {
        MockGateway::from_config(SECRET, "https://panel.test/", DEFAULT_MOCK_TOLERANCE_SECS)
            .unwrap()
    }

    fn signed(body: &str) -> WebhookRequest {
        signed_at(body, Utc::now().timestamp())
    }

    fn signed_at(body: &str, timestamp: i64) -> WebhookRequest {
        WebhookRequest {
            headers: vec![
                (MOCK_TIMESTAMP_HEADER.into(), timestamp.to_string()),
                (
                    MOCK_SIGNATURE_HEADER.into(),
                    sign_webhook(SECRET, timestamp, body.as_bytes()),
                ),
            ],
            body: body.as_bytes().to_vec(),
        }
    }

    #[test]
    fn checkout_url_is_built_from_public_url() {
        let invoice_id = Uuid::new_v4();
        let session = gateway()
            .create_checkout(CheckoutRequest {
                user_id: Uuid::new_v4(),
                plan_id: Uuid::new_v4(),
                invoice_id,
                amount_cents: 99_000,
                currency: "RUB".into(),
                success_url: "https://panel.test/billing?status=success".into(),
                cancel_url: "https://panel.test/billing?status=cancel".into(),
            })
            .unwrap();
        assert_eq!(
            session.url,
            format!("https://panel.test/pay/mock/{invoice_id}")
        );
        assert_eq!(session.gateway_ref, format!("mock-chk-{invoice_id}"));
    }

    #[test]
    fn checkout_url_falls_back_to_localhost() {
        let gateway = MockGateway::from_config(SECRET, "   ", 300).unwrap();
        let invoice_id = Uuid::new_v4();
        let session = gateway
            .create_checkout(CheckoutRequest {
                user_id: Uuid::new_v4(),
                plan_id: Uuid::new_v4(),
                invoice_id,
                amount_cents: 1000,
                currency: "RUB".into(),
                success_url: String::new(),
                cancel_url: String::new(),
            })
            .unwrap();
        assert_eq!(
            session.url,
            format!("http://localhost/pay/mock/{invoice_id}")
        );
    }

    #[test]
    fn signature_is_verified_and_tampering_is_rejected() {
        let gateway = gateway();
        let now = Utc::now();
        let request = signed_at(
            r#"{"event_id":"evt-1","kind":"payment.succeeded"}"#,
            now.timestamp(),
        );
        assert!(gateway.verify_webhook(&request, now).is_ok());

        let mut tampered = request.clone();
        tampered.body = br#"{"event_id":"evt-1","kind":"refund.succeeded"}"#.to_vec();
        assert!(gateway.verify_webhook(&tampered, now).is_err());

        let mut missing = request.clone();
        missing.headers.clear();
        assert!(gateway.verify_webhook(&missing, now).is_err());

        let mut bad_hex = request;
        bad_hex.headers[1].1 = "zz".into();
        assert!(gateway.verify_webhook(&bad_hex, now).is_err());
    }

    #[test]
    fn old_and_future_timestamps_are_rejected() {
        let gateway = gateway();
        let body = br#"{"event_id":"evt-1","kind":"payment.succeeded"}"#;
        for timestamp in [Utc::now().timestamp() - 301, Utc::now().timestamp() + 301] {
            let request = WebhookRequest {
                headers: vec![
                    (MOCK_TIMESTAMP_HEADER.into(), timestamp.to_string()),
                    (
                        MOCK_SIGNATURE_HEADER.into(),
                        sign_webhook(SECRET, timestamp, body),
                    ),
                ],
                body: body.to_vec(),
            };
            let now = Utc::now();
            assert!(gateway.verify_webhook(&request, now).is_err());
        }
    }

    #[test]
    fn parse_event_decodes_payment_fields() {
        let gateway = gateway();
        let body = format!(
            r#"{{"event_id":"evt-1","kind":"payment.succeeded","invoice_id":"{}","amount_cents":99000,"currency":"rub","gateway_ref":"gw-1","payment_method":{{"gateway_ref":"pm-1","brand":"visa","last4":"4242"}}}}"#,
            Uuid::new_v4()
        );
        let event = gateway.parse_event(&signed(&body)).unwrap();
        assert_eq!(event.gateway, "mock");
        assert_eq!(event.event_id, "evt-1");
        assert_eq!(event.kind, PaymentEventKind::PaymentSucceeded);
        assert_eq!(event.amount_cents, Some(99_000));
        assert_eq!(event.currency.as_deref(), Some("rub"));
        assert_eq!(event.gateway_ref.as_deref(), Some("gw-1"));
        let method = event.payment_method.unwrap();
        assert_eq!(method.gateway_ref, "pm-1");
        assert_eq!(method.brand, "visa");
        assert_eq!(method.last4, "4242");
    }

    #[test]
    fn parse_event_rejects_malformed_payloads() {
        let gateway = gateway();
        assert!(gateway.parse_event(&signed("not-json")).is_err());
        assert!(
            gateway
                .parse_event(&signed(r#"{"event_id":"","kind":"payment.succeeded"}"#))
                .is_err()
        );
    }

    #[test]
    fn signature_matches_reference_vector() {
        let signature = sign_webhook("secret", 1_700_000_000, b"payload");
        assert_eq!(
            signature,
            "5af4877ab3c93d3201223b2c43d689a4c1e849ddd9091e066f03be6168ae79e9"
        );
    }

    #[test]
    fn payload_hash_is_sha256_hex() {
        assert_eq!(
            payload_sha256(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn hex_roundtrip_and_rejects_invalid_input() {
        assert_eq!(encode_hex(&[0x00, 0x0f, 0xff]), "000fff");
        assert_eq!(decode_hex("000fff"), Some(vec![0x00, 0x0f, 0xff]));
        assert_eq!(decode_hex("abc"), None);
        assert_eq!(decode_hex("zz"), None);
    }

    #[test]
    fn from_config_validates_secret_length() {
        assert!(MockGateway::from_config("short", "http://localhost", 300).is_err());
        assert!(MockGateway::from_config(SECRET, "http://localhost", 300).is_ok());
        assert_eq!(gateway().provider_name(), "mock");
    }
}
