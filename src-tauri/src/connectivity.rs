//! Endpoint reachability diagnosis (T-304).
//!
//! Resolves and probes the proxy when configured, otherwise the endpoint.
//! HTTPS HEAD uses an explicit HTTP CONNECT proxy or explicit direct mode.
//! Certificate validation is disabled only for this HTTPS diagnosis.
//! Native Speech/WSS sessions are checked separately by the sidecar.
//!
//! Each step produces a `Step { step, status, detail }` entry so the
//! renderer can render the same expandable diagnosis card as the
//! Electron variant.

use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::settings::AzureProxyConfig;

const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub step: String,
    pub status: StepStatus,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StepStatus {
    Ok,
    Warn,
    Error,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectivityResult {
    pub probe_url: String,
    pub reachable: bool,
    pub https_reachable: bool,
    pub speech_reachable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http_status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http_status_text: Option<String>,
    pub latency_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub steps: Vec<Step>,
}

fn probe_url_from_endpoint(endpoint: &str, language: &str) -> Result<url::Url, String> {
    let endpoint = endpoint.trim();
    let normalized = if endpoint.contains("://") {
        endpoint.to_string()
    } else {
        format!("https://{endpoint}")
    };
    let mut url = url::Url::parse(&normalized).map_err(|_| "Ungültiger Endpoint".to_string())?;
    if !matches!(url.scheme(), "https" | "wss") || url.host_str().is_none()
        || !url.username().is_empty() || url.password().is_some()
    {
        return Err("Endpoint muss HTTPS/WSS ohne Zugangsdaten verwenden".into());
    }
    url.set_scheme("https").map_err(|_| "Ungültiger Endpoint".to_string())?;
    url.set_path("/speech/recognition/interactive/cognitiveservices/v1");
    url.set_query(None);
    url.set_fragment(None);
    url.query_pairs_mut().append_pair("language", language);
    Ok(url)
}

pub fn configured_proxy(proxy: &AzureProxyConfig) -> Result<reqwest::Proxy, String> {
    let host = proxy.host.trim();
    if host.is_empty() || proxy.port == 0 || host.contains("://")
        || host.contains('/') || host.contains('@') || host.contains('?') || host.contains('#')
    {
        return Err("Proxy benötigt einen Host ohne Schema/Pfad und Port 1–65535".into());
    }
    let host = if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_string()
    };
    let mut configured = reqwest::Proxy::all(format!("http://{host}:{}", proxy.port))
        .map_err(|_| "Ungültiger Proxy-Host".to_string())?;
    if let Some(username) = proxy.username.as_deref() {
        configured = configured.basic_auth(username, proxy.password.as_deref().unwrap_or(""));
    }
    Ok(configured)
}

async fn dns_lookup_system(host: &str) -> Option<std::net::IpAddr> {
    let mut response = tokio::time::timeout(PROBE_TIMEOUT, tokio::net::lookup_host((host, 0)))
        .await.ok()?.ok()?;
    response.next().map(|address| address.ip())
}

async fn tcp_probe(host: &str, port: u16) -> Result<u128, String> {
    use tokio::net::TcpStream;
    let start = Instant::now();
    let connect = tokio::time::timeout(PROBE_TIMEOUT, TcpStream::connect((host, port))).await;
    match connect {
        Ok(Ok(_)) => Ok(start.elapsed().as_millis()),
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Err(format!("timeout after {} ms", PROBE_TIMEOUT.as_millis())),
    }
}

async fn https_probe(
    url: &str,
    subscription_key: &str,
    proxy: Option<&AzureProxyConfig>,
) -> Result<(u16, String, u128), String> {
    // Explicit direct mode must not silently inherit an environment proxy.
    let mut builder = reqwest::Client::builder()
        .no_proxy()
        .timeout(PROBE_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .danger_accept_invalid_certs(true);
    if let Some(proxy) = proxy {
        builder = builder.proxy(configured_proxy(proxy)?);
    }
    let client = builder.build().map_err(|e| e.to_string())?;
    let start = Instant::now();
    let response = client
        .head(url)
        .header("Ocp-Apim-Subscription-Key", subscription_key)
        .send()
        .await
        .map_err(|error| {
            let error = error.without_url();
            let mut detail = error.to_string();
            let mut source = std::error::Error::source(&error);
            while let Some(cause) = source {
                detail.push_str(": ");
                detail.push_str(&cause.to_string());
                source = cause.source();
            }
            detail
        })?;
    let status = response.status().as_u16();
    let text = response.status().canonical_reason().unwrap_or("").to_string();
    Ok((status, text, start.elapsed().as_millis()))
}

pub async fn diagnose(
    endpoint: &str,
    subscription_key: &str,
    language: &str,
    proxy: Option<&AzureProxyConfig>,
) -> ConnectivityResult {
    let mut steps = Vec::new();
    let parsed_url = match probe_url_from_endpoint(endpoint, language) {
        Ok(url) => url,
        Err(error) => return ConnectivityResult {
            probe_url: String::new(),
            reachable: false,
            https_reachable: false,
            speech_reachable: false,
            http_status: None,
            http_status_text: None,
            latency_ms: 0,
            error: Some(error.clone()),
            steps: vec![Step { step: "config".into(), status: StepStatus::Error, detail: error }],
        },
    };
    let endpoint_host = parsed_url.host_str().unwrap_or_default();
    let host = proxy.map(|p| p.host.trim().trim_matches(['[', ']']))
        .unwrap_or(endpoint_host);
    let port = proxy.map(|p| p.port).unwrap_or(parsed_url.port_or_known_default().unwrap_or(443));
    steps.push(Step {
        step: "transport".into(),
        status: StepStatus::Ok,
        detail: if proxy.is_some() {
            format!("HTTP-Proxy {host}:{port}; HTTPS via CONNECT. Endpoint-DNS erfolgt am Proxy.")
        } else {
            "Direktverbindung; Umgebungsproxies werden nicht übernommen.".into()
        },
    });
    steps.push(Step {
        step: "https-tls".into(),
        status: StepStatus::Warn,
        detail: "HTTPS-Diagnose ignoriert Zertifikatsprüfungen (unsicher). Dies gilt nicht für Speech/WSS.".into(),
    });
    steps.push(Step {
        step: "endpoint".into(),
        status: StepStatus::Ok,
        detail: format!("Endpoint-Host: {endpoint_host}; DNS/TCP-Ziel: {host}:{port}"),
    });

    let mut resolved_ip: Option<std::net::IpAddr> = None;
    let dns_start = Instant::now();
    match dns_lookup_system(&host).await {
        Some(ip) => {
            resolved_ip = Some(ip);
            steps.push(Step {
                step: "dns-system".into(),
                status: StepStatus::Ok,
                detail: format!("System-DNS liefert {ip} ({} ms)", dns_start.elapsed().as_millis()),
            });
        }
        None => steps.push(Step {
            step: "dns-system".into(),
            status: StepStatus::Warn,
            detail: "System-DNS-Auflösung fehlgeschlagen; maßgeblich ist die HTTPS-Probe.".into(),
        }),
    }

    if let Some(ip) = resolved_ip {
        match tcp_probe(&ip.to_string(), port).await {
            Ok(ms) => steps.push(Step {
                step: "tcp".into(),
                status: StepStatus::Ok,
                detail: format!("TCP {port} zu {ip} offen ({ms} ms)"),
            }),
            Err(e) => steps.push(Step {
                step: "tcp".into(),
                status: StepStatus::Warn,
                detail: format!("TCP {port} zu {ip} fehlgeschlagen ({e}); maßgeblich ist die nachfolgende HTTPS-Probe."),
            }),
        }
    }

    let probe_url = parsed_url.to_string();
    let https_start = Instant::now();
    match https_probe(&probe_url, subscription_key, proxy).await {
        Ok((status, text, _)) => {
            let latency = https_start.elapsed().as_millis() as u64;
            let status_label = if status == 401 || status == 403 { StepStatus::Ok } else { StepStatus::Warn };
            steps.push(Step {
                step: "https-probe".into(),
                status: status_label,
                detail: format!("HTTPS-Probe HTTP {status} {text} ({latency} ms)"),
            });
            ConnectivityResult {
                probe_url,
                reachable: status != 407,
                https_reachable: status != 407,
                speech_reachable: false,
                http_status: Some(status),
                http_status_text: Some(text),
                latency_ms: latency,
                error: None,
                steps,
            }
        }
        Err(e) => {
            let latency = https_start.elapsed().as_millis() as u64;
            steps.push(Step {
                step: "https-probe".into(),
                status: StepStatus::Error,
                detail: format!("HTTPS-Probe fehlgeschlagen: {e} ({latency} ms)"),
            });
            ConnectivityResult {
                probe_url,
                reachable: false,
                https_reachable: false,
                speech_reachable: false,
                http_status: None,
                http_status_text: None,
                latency_ms: latency,
                error: Some(e),
                steps,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn normalizes_https_and_wss_endpoint_paths() {
        for endpoint in ["https://example.test:8443", "wss://example.test:8443/old?x=1"] {
            let url = probe_url_from_endpoint(endpoint, "de-DE&x=2").unwrap();
            assert_eq!(url.scheme(), "https");
            assert_eq!(url.port(), Some(8443));
            assert_eq!(url.path(), "/speech/recognition/interactive/cognitiveservices/v1");
            assert_eq!(url.query_pairs().collect::<Vec<_>>(), vec![("language".into(), "de-DE&x=2".into())]);
        }
        assert!(probe_url_from_endpoint("https://u:p@example.test", "de-DE").is_err());
        assert!(probe_url_from_endpoint("http://example.test", "de-DE").is_err());
    }

    #[test]
    fn validates_proxy_host_and_port_without_leaking_credentials() {
        for host in ["", "http://proxy.test", "u:p@proxy.test", "proxy.test/path"] {
            let proxy = AzureProxyConfig { host: host.into(), port: 8080, username: None, password: None };
            assert!(configured_proxy(&proxy).is_err());
        }
        let proxy = AzureProxyConfig { host: "::1".into(), port: 8080, username: None, password: None };
        assert!(configured_proxy(&proxy).is_ok());
    }

    #[tokio::test]
    async fn https_uses_authenticated_connect_even_when_endpoint_dns_fails() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut buffer = [0; 1024];
            loop {
                let count = stream.read(&mut buffer).await.unwrap();
                assert!(count > 0);
                request.extend_from_slice(&buffer[..count]);
                if request.windows(4).any(|bytes| bytes == b"\r\n\r\n") { break; }
            }
            let request = String::from_utf8(request).unwrap().to_lowercase();
            assert!(request.starts_with("connect no-such-endpoint.invalid:443 http/1.1"));
            assert!(request.contains("proxy-authorization: basic dtpw"));
            assert!(!request.contains("ocp-apim-subscription-key"));
            stream.write_all(b"HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n").await.unwrap();
        });
        let proxy = AzureProxyConfig {
            host: "127.0.0.1".into(), port, username: Some("u".into()), password: Some("p".into()),
        };
        let error = https_probe("https://no-such-endpoint.invalid/", "fake-key", Some(&proxy)).await.unwrap_err();
        assert!(error.contains("proxy authorization required"), "{error}");
        assert!(!error.contains("fake-key"));
        tokio::time::timeout(PROBE_TIMEOUT, server).await.unwrap().unwrap();
    }
}
