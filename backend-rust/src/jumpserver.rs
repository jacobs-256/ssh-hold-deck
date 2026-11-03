use crate::{s, Error, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;
pub const DEFAULT_ORG: &str = "00000000-0000-0000-0000-000000000002";
fn uuid(s: &str) -> bool {
    uuid::Uuid::parse_str(s).is_ok()
}
pub fn normalize(input: &Value, previous: &Value) -> Result<Value> {
    let name = s(input, "name").trim();
    let url =
        url::Url::parse(s(input, "url")).map_err(|_| Error::bad("JumpServer API 地址无效"))?;
    if name.is_empty() || name.chars().count() > 100 {
        return Err(Error::bad("请填写 JumpServer 名称（最多 100 字）"));
    }
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(Error::bad(
            "API 地址须为 HTTPS 服务地址，不含路径或登录信息",
        ));
    }
    let origin = url.origin().ascii_serialization();
    let key = s(input, "keyId").trim();
    let secret = if !s(input, "keySecret").is_empty() {
        s(input, "keySecret")
    } else if s(previous, "url") == origin && s(previous, "keyId") == key {
        s(previous, "keySecret")
    } else {
        ""
    };
    let org = if s(input, "orgId").is_empty() {
        DEFAULT_ORG
    } else {
        s(input, "orgId")
    };
    let host = if s(input, "sshHost").is_empty() {
        url.host_str().unwrap_or("")
    } else {
        s(input, "sshHost")
    };
    let port = input["sshPort"].as_u64().unwrap_or(2222);
    if !uuid(key) || secret.trim().is_empty() || secret.len() > 4096 {
        return Err(Error::bad(
            "请填写有效的 Key ID 和 Key Secret；更换地址或 Key ID 时须重新输入 Secret",
        ));
    }
    if !uuid(org)
        || host.is_empty()
        || !host
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".:-".contains(&b))
        || !(1..=65535).contains(&port)
    {
        return Err(Error::bad("组织 ID 或 SSH 网关地址、端口无效"));
    }
    Ok(
        json!({"id":previous["id"].as_str().map(str::to_owned).unwrap_or_else(||uuid::Uuid::new_v4().to_string()),"name":name,"url":origin,"keyId":key,"keySecret":secret,"orgId":org,"sshHost":host,"sshPort":port}),
    )
}
pub fn public(server: &Value) -> Value {
    let mut value = server.clone();
    value.as_object_mut().unwrap().remove("keySecret");
    value["hasSecret"] = json!(!s(server, "keySecret").is_empty());
    value
}
pub fn authorization(server: &Value, method: &str, path: &str, date: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(s(server, "keySecret").as_bytes()).unwrap();
    mac.update(
        format!(
            "(request-target): {} {path}\naccept: application/json\ndate: {date}",
            method.to_lowercase()
        )
        .as_bytes(),
    );
    format!("Signature keyId=\"{}\",algorithm=\"hmac-sha256\",headers=\"(request-target) accept date\",signature=\"{}\"",s(server,"keyId"),STANDARD.encode(mac.finalize().into_bytes()))
}
pub async fn api(server: &Value, path: &str, method: &str, body: Option<Value>) -> Result<Value> {
    let date = httpdate::fmt_http_date(std::time::SystemTime::now());
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(15))
        .build()?;
    let mut request = client
        .request(
            method.parse().unwrap(),
            format!("{}{path}", s(server, "url")),
        )
        .header("accept", "application/json")
        .header("date", &date)
        .header("X-JMS-ORG", s(server, "orgId"))
        .header("Authorization", authorization(server, method, path, &date))
        .header("content-type", "application/json");
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request
        .send()
        .await
        .map_err(|_| Error::bad("JumpServer 请求失败，请检查网络、HTTPS 证书和服务地址"))?;
    let status = response.status();
    let bytes = crate::system::response_bytes(response, 8 * 1024 * 1024).await?;
    let data: Value =
        serde_json::from_slice(&bytes).map_err(|_| Error::bad("JumpServer 未返回有效 JSON"))?;
    if !status.is_success() {
        return Err(Error::bad(match s(&data, "code") {
            "acl_review" => "该资产需要登录审批，请先在 JumpServer 完成审批",
            "acl_reject" => "JumpServer 登录规则拒绝了连接",
            "perm_expired" => "JumpServer 资产授权已过期",
            _ => match status.as_u16() {
                401 => "JumpServer 认证失败，请检查密钥和本机时间",
                403 => "JumpServer 权限不足或要求额外认证",
                404 => "JumpServer 资产或 API 不存在",
                _ => "JumpServer 拒绝了请求，请检查资产、账号或连接策略",
            },
        }));
    }
    Ok(data)
}
pub async fn organizations(server: &Value) -> Result<Value> {
    let data = api(server, "/api/v1/users/profile/permissions/", "GET", None).await?;
    let orgs = data["workbench_orgs"]
        .as_array()
        .ok_or_else(|| Error::bad("JumpServer 未返回可访问的组织列表"))?;
    Ok(
        json!({"organizations":orgs.iter().filter(|o|uuid(s(o,"id"))&&o["is_root"]!=true&&o["is_system"]!=true).map(|o|json!({"id":o["id"],"name":o["name"],"isDefault":o["is_default"]==true})).collect::<Vec<_>>()}),
    )
}
pub async fn assets(server: &Value, search: &str, offset: u64, limit: u64) -> Result<Value> {
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("limit", &limit.to_string())
        .append_pair("offset", &offset.to_string())
        .append_pair("search", search)
        .finish();
    let data = api(
        server,
        &format!("/api/v1/perms/users/self/assets/?{query}"),
        "GET",
        None,
    )
    .await?;
    let rows = data
        .as_array()
        .or_else(|| data["results"].as_array())
        .ok_or_else(|| Error::bad("JumpServer 资产列表格式不兼容"))?;
    Ok(
        json!({"count":data["count"].as_u64().unwrap_or(rows.len() as u64),"results":rows.iter().map(|a|json!({"id":a["id"],"name":a["name"],"address":a["address"],"orgId":a["org_id"],"orgName":a["org_name"],"active":a["is_active"]!=false})).collect::<Vec<_>>()}),
    )
}
pub async fn asset(server: &Value, id: &str) -> Result<Value> {
    if !uuid(id) {
        return Err(Error::bad("资产 ID 无效"));
    }
    let a = api(
        server,
        &format!("/api/v1/perms/users/self/assets/{id}/"),
        "GET",
        None,
    )
    .await?;
    let protocols = a["permed_protocols"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let ssh = protocols
        .iter()
        .find(|p| p.as_str() == Some("ssh") || p["name"] == "ssh");
    if a["is_active"] == false || ssh.is_none() {
        return Err(Error::bad("该资产未启用或没有 SSH 访问授权"));
    }
    let accounts=a["permed_accounts"].as_array().cloned().unwrap_or_default().into_iter().filter(|a|a["has_secret"]==true&&a["has_username"]!=false&&a["username"]!="@INPUT"&&a["actions"].as_array().is_some_and(|actions|actions.iter().any(|v|v=="connect"||v["value"]=="connect"))).map(|a|json!({"alias":a.get("alias").or(a.get("id")).unwrap_or(&a["username"]),"name":a["name"],"username":a["username"]})).collect::<Vec<_>>();
    Ok(
        json!({"id":a["id"],"name":a["name"],"address":a["address"],"orgId":a["org_id"],"sshPort":ssh.and_then(|p|p["port"].as_u64()).unwrap_or(22),"accounts":accounts}),
    )
}
pub async fn channel(server: &Value, input: &Value) -> Result<Value> {
    let a = asset(server, s(input, "assetId")).await?;
    let account = a["accounts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["alias"] == input["account"])
        .ok_or_else(|| Error::bad("请选择有连接权限且已托管凭据的资产账号"))?;
    Ok(
        json!({"source":"jumpserver","serverId":server["id"],"assetId":a["id"],"assetName":a["name"],"assetAddress":a["address"],"account":account["alias"],"accountUsername":account["username"],"target":format!("{}@{}",s(account,"username"),s(&a,"address")),"port":a["sshPort"],"auth":"jumpserver","jump":"","insecure":input["insecure"]==true}),
    )
}
pub async fn resolve(server: &Value, config: &Value) -> Result<Value> {
    channel(server, config).await?;
    let token=api(server,"/api/v1/authentication/connection-token/","POST",Some(json!({"asset":config["assetId"],"account":config["account"],"protocol":"ssh","connect_method":"ssh"}))).await?;
    if token["is_active"] == false
        || token
            .get("from_ticket")
            .is_some_and(|v| !v.is_null() && v != false && v != "")
    {
        return Err(Error::bad(
            "该连接需要 JumpServer 审批，请在堡垒机完成审批后重试",
        ));
    }
    if !uuid(s(&token, "id")) || s(&token, "value").is_empty() {
        return Err(Error::bad("JumpServer 返回的连接令牌无效"));
    }
    let mut value = config.clone();
    value["target"] = json!(format!("JMS-{}@{}", s(&token, "id"), s(server, "sshHost")));
    value["port"] = server["sshPort"].clone();
    value["auth"] = json!("password");
    value["password"] = token["value"].clone();
    Ok(value)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn signed_requests_permissions_and_fresh_tokens() {
        use axum::{
            body::Bytes,
            http::{HeaderMap, Method, Uri},
            routing::any,
            Json, Router,
        };
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let server = json!({"id":"test","url":format!("http://{}",listener.local_addr().unwrap()),"keyId":"test-key","keySecret":"test-secret","orgId":DEFAULT_ORG,"sshHost":"bastion.example","sshPort":2222});
        let count = Arc::new(AtomicUsize::new(0));
        let expected = server.clone();
        let tokens = count.clone();
        let router = Router::new().fallback(any(move |headers:HeaderMap, method:Method, uri:Uri, body:Bytes| {
            let server=expected.clone();let tokens=tokens.clone();
            async move {
                assert_eq!(headers["x-jms-org"],DEFAULT_ORG);
                assert_eq!(headers["authorization"].to_str().unwrap(),authorization(&server,method.as_str(),&uri.to_string(),headers["date"].to_str().unwrap()));
                let id="00000000-0000-0000-0000-000000000001";
                let data=if uri.path().ends_with("permissions/") {
                    json!({"workbench_orgs":[{"id":id,"name":"team"},{"id":DEFAULT_ORG,"is_root":true}]})
                }else if uri.path().ends_with("connection-token/") {
                    let body:Value=serde_json::from_slice(&body).unwrap();assert_eq!(body["account"],"root");
                    json!({"id":id,"value":format!("temporary-{}",tokens.fetch_add(1,Ordering::SeqCst))})
                }else if uri.path().ends_with("assets/") {
                    assert!(uri.query().unwrap().contains("search=a%26b"));json!({"count":1,"results":[{"id":id,"name":"asset","address":"10.0.0.1"}]})
                }else {
                    json!({"id":id,"name":"asset","address":"10.0.0.1","permed_protocols":[{"name":"ssh","port":22}],"permed_accounts":[{"alias":"root","username":"root","has_secret":true,"actions":["connect"]},{"alias":"bad","username":"@INPUT","has_secret":true,"actions":["connect"]}]})
                }; Json(data)
            }
        }));
        let task = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        assert_eq!(
            organizations(&server).await.unwrap()["organizations"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(assets(&server, "a&b", 0, 30).await.unwrap()["count"], 1);
        let input = json!({"assetId":"00000000-0000-0000-0000-000000000001","account":"root"});
        let config = channel(&server, &input).await.unwrap();
        assert!(config.get("password").is_none());
        let one = resolve(&server, &config).await.unwrap();
        let two = resolve(&server, &config).await.unwrap();
        assert_eq!(
            one["target"],
            "JMS-00000000-0000-0000-0000-000000000001@bastion.example"
        );
        assert_ne!(one["password"], two["password"]);
        assert_eq!(count.load(Ordering::SeqCst), 2);
        let mut bad = input;
        bad["account"] = json!("bad");
        assert!(channel(&server, &bad).await.is_err());
        task.abort();
        let _ = task.await;
    }
    #[test]
    fn signature_fixture() {
        let server = json!({"keyId":"test","keySecret":"secret"});
        assert!(
            authorization(&server, "GET", "/test?a=1", "Mon, 02 Nov 2026 00:00:00 GMT")
                .ends_with("signature=\"YVZIzuluDYKQa5fUGGIRSyrKZzi1ZCl48WEKFtGA5Ik=\"")
        );
        assert!(
            authorization(&server, "GET", "/test?a=1", "Mon, 02 Nov 2026 00:00:00 GMT")
                .contains("headers=\"(request-target) accept date\"")
        );
        assert_ne!(
            authorization(&server, "GET", "/test?a=1", "x"),
            authorization(&server, "GET", "/test?a=2", "x")
        );
    }
    #[test]
    fn secret_retention() {
        let id = "00000000-0000-0000-0000-000000000001";
        let old=normalize(&json!({"name":"test","url":"https://example.com","keyId":id,"keySecret":"test-secret"}),&Value::Null).unwrap();
        let mut input = old.clone();
        input["keySecret"] = json!("");
        assert_eq!(normalize(&input, &old).unwrap()["keySecret"], "test-secret");
        input["url"] = json!("https://other.example.com");
        assert!(normalize(&input, &old).is_err());
    }
}
