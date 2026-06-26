//! Endpoint reachability diagnosis (T-304).
//!
//! Runs the same probe chain as the legacy Node azure-connectivity:
//!   1. System DNS lookup of the endpoint host
//!   2. Fallback DNS lookup (hickory resolver, IPv4)
//!   3. TCP probe to port 443 of the resolved IP
//!   4. HTTPS HEAD probe to /speech/recognition/interactive/...
//!
//! Each step produces a `Step { step, status, detail }` entry so the
//! renderer can render the same expandable diagnosis card as the
//! Electron variant.

use std::time::{Duration, Instant};

use hickory_resolver::TokioAsyncResolver;
use hickory_resolver::config::{ResolverConfig, ResolverOpts};
use serde::Serialize;

const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub step: String,
    pub status: StepStatus,
    pub detail: String,
}

#[derive(Clone, Debug, Serialize)]
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http_status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http_status_text: Option<String>,
    pub latency_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub steps: Vec<Step>,
}

fn host_from_endpoint(endpoint: &str) -> String {
    endpoint
        .replace("wss://", "")
        .replace("https://", "")
        .replace("http://", "")
        .split('/')
        .next()
        .unwrap_or("")
        .trim()
        .to_string()
}

fn probe_url_from_endpoint(endpoint: &str, language: &str) -> String {
    let stripped = endpoint
        .replace("wss://", "https://")
        .replace("https://", "");
    let base = stripped.trim_end_matches('/');
    format!("https://{base}/speech/recognition/interactive/cognitiveservices/v1?language={language}")
}

async fn dns_lookup_system(host: &str) -> Option<std::net::IpAddr> {
    let resolver = TokioAsyncResolver::tokio(ResolverConfig::default(), ResolverOpts::default());
    let response = resolver.lookup_ip(host).await.ok()?;
    response.iter().next()
}

async fn dns_lookup_fallback(host: &str) -> Option<std::net::IpAddr> {
    let resolver = TokioAsyncResolver::tokio(ResolverConfig::default(), ResolverOpts::default());
    let response = resolver.lookup_ip(host).await.ok()?;
    response.iter().next()
}

async fn tcp_probe(host: &str, port: u16) -> Result<u128, String> {
    use tokio::net::TcpStream;
    let addr: std::net::SocketAddr = format!("{host}:{port}")
        .parse()
        .map_err(|e: std::net::AddrParseError| e.to_string())?;
    let start = Instant::now();
    let connect = tokio::time::timeout(PROBE_TIMEOUT, TcpStream::connect(addr)).await;
    match connect {
        Ok(Ok(_)) => Ok(start.elapsed().as_millis()),
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Err(format!("timeout after {} ms", PROBE_TIMEOUT.as_millis())),
    }
}

async fn https_probe(url: &str, subscription_key: &str) -> Result<(u16, String, u128), String> {
    let client = reqwest::Client::builder()
        .timeout(PROBE_TIMEOUT)
        .danger_accept_invalid_certs(false)
        .build()
        .map_err(|e| e.to_string())?;
    let start = Instant::now();
    let response = client
        .head(url)
        .header("Ocp-Apim-Subscription-Key", subscription_key)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let text = response.status().canonical_reason().unwrap_or("").to_string();
    Ok((status, text, start.elapsed().as_millis()))
}

pub async fn diagnose(
    endpoint: &str,
    subscription_key: &str,
    language: &str,
) -> ConnectivityResult {
    let mut steps = Vec::new();
    let trimmed = endpoint.trim();
    if trimmed.is_empty() {
        steps.push(Step {
            step: "config".into(),
            status: StepStatus::Error,
            detail: "Kein Endpoint konfiguriert".into(),
        });
        return ConnectivityResult {
            probe_url: String::new(),
            reachable: false,
            http_status: None,
            http_status_text: None,
            latency_ms: 0,
            error: Some("Endpoint-Diagnose: Kein Endpoint konfiguriert.".into()),
            steps,
        };
    }

    let host = host_from_endpoint(trimmed);
    steps.push(Step {
        step: "endpoint".into(),
        status: StepStatus::Ok,
        detail: format!("Endpoint-Host: {host}"),
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
            status: StepStatus::Error,
            detail: "System-DNS-Auflösung fehlgeschlagen".into(),
        }),
    }

    match dns_lookup_fallback(&host).await {
        Some(ip) if Some(ip) != resolved_ip => steps.push(Step {
            step: "dns-conflict".into(),
            status: StepStatus::Warn,
            detail: format!(
                "Fallback-DNS liefert {ip}, System-DNS liefert {}. Corporate-DNS filtert möglicherweise Custom-Domains.",
                resolved_ip.map(|x| x.to_string()).unwrap_or_else(|| "<NXDOMAIN>".into())
            ),
        }),
        Some(_) => steps.push(Step {
            step: "dns-fallback".into(),
            status: StepStatus::Ok,
            detail: format!("Fallback-DNS bestätigt {}", resolved_ip.map(|x| x.to_string()).unwrap_or_default()),
        }),
        None => steps.push(Step {
            step: "dns-fallback".into(),
            status: StepStatus::Warn,
            detail: "Fallback-DNS-Auflösung nicht möglich".into(),
        }),
    }

    if let Some(ip) = resolved_ip {
        match tcp_probe(&ip.to_string(), 443).await {
            Ok(ms) => steps.push(Step {
                step: "tcp-443".into(),
                status: StepStatus::Ok,
                detail: format!("TCP 443 zu {ip} offen ({ms} ms)"),
            }),
            Err(e) => steps.push(Step {
                step: "tcp-443".into(),
                status: StepStatus::Error,
                detail: format!("TCP 443 zu {ip} blockiert ({e}). Firewall blockt direkte HTTPS-Verbindungen - Verbindung muss über Proxy laufen."),
            }),
        }
    }

    let probe_url = probe_url_from_endpoint(trimmed, language);
    let https_start = Instant::now();
    match https_probe(&probe_url, subscription_key).await {
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
                reachable: true,
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
                http_status: None,
                http_status_text: None,
                latency_ms: latency,
                error: Some(e),
                steps,
            }
        }
    }
}
