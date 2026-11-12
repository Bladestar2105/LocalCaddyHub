# Exchange deployment: replacing a KEMP front end

LocalCaddyHub can configure HTTP upstream pools and NTLM transport, but a production Exchange migration needs validation against the actual Exchange build, authentication modes and clients. The automated repository tests use simulated backends; they do not certify Exchange, NTLM channel binding, Outlook or Extended Protection interoperability.

## Starting configuration

Use [examples/exchange-dag.json](../examples/exchange-dag.json) as the structured configuration body for `POST /api/config/structured` after authenticating and completing account setup. This endpoint replaces the full managed configuration; export/back up the current state first. Use the `X-Requested-With: XMLHttpRequest` header with the authenticated session. Replace all documentation-only addresses (`192.0.2.10`, `192.0.2.11`), public namespaces and health Host headers before saving. Upload `exchange-front-end.pem`, its matching `exchange-front-end.key`, and the backend CA chain as `exchange-ca.pem`; these files must exist before validation. The front-end certificate must be the same certificate used by the Exchange IIS front ends when Extended Protection is enabled.

The example creates seven distinct service health pools. NTLM-enabled pools use `ip_hash`; the generator enforces it when NTLM has multiple upstreams because round-robin can separate a Type1/Type3 handshake. Each client connection still receives its own NTLM transport, preventing shared authentication contexts. WAF starts disabled in this template until legitimate traffic for the actual Exchange version has been accepted and exclusions have been reviewed. Enable it deliberately and verify both application traffic and representative attacks. The Exchange WAF profile admits the required binary MIME types only on their Exchange virtual directories, keeps CRS attack checks, and sets an explicit 128 MiB body cap in this template. The generic profile retains its 12.5 MiB cap; neither profile is an unlimited upload path. Tune the per-handler cap to the accepted request size and available memory/concurrency, allowing for SOAP/base64 expansion of attachments. For the exact EWS `/EWS/Exchange.asmx` endpoint with an XML MIME type, namespace-aware parsing treats strictly valid base64 in Exchange `FileAttachment.Content` and `MimeContent` as opaque file bytes instead of running text attack regexes on encoded data. It still inspects XML metadata and all attributes, headers and query parameters, including metadata after an attachment; invalid base64 fails closed. Content in another namespace or outside the recognized file fields remains inspected. This WAF is not antivirus: use Exchange/endpoint attachment malware scanning for the decoded file contents.

`handle` preserves the directory prefix. The `/<service>*` matchers include both bare and descendant paths and also match other paths beginning with that prefix; refine path rules if your namespace contains similarly named applications. Do not use `handle_path` for Exchange directories because it strips the matched prefix.

## Namespace and service pools

Keep the existing public namespace, such as `mail.example.com`, and the required `autodiscover.example.com` name in DNS, certificates and Exchange virtual-directory URLs. Point the VIP to the proxies only after both have been tested. The upstream pool contains the client-access HTTPS endpoint on each Exchange mailbox server, not the DAG cluster name or database replication endpoints.

Create a separate handler/pool for each published service when per-service health matters. Preserve the incoming request path, query, method and public Host header; do not strip the virtual-directory prefix. Include both the bare path and its descendants where clients use both. Autodiscover's public hostname may use its own domain entry.

| Service | Path prefix | Managed Availability probe |
| --- | --- | --- |
| Outlook on the web | `/owa` | `/owa/healthcheck.htm` |
| Exchange admin center | `/ecp` | `/ecp/healthcheck.htm` |
| Exchange Web Services | `/EWS` | `/EWS/healthcheck.htm` |
| MAPI over HTTP | `/mapi` | `/mapi/healthcheck.htm` |
| ActiveSync | `/Microsoft-Server-ActiveSync` | `/Microsoft-Server-ActiveSync/healthcheck.htm` |
| Offline address book | `/OAB` | `/OAB/healthcheck.htm` |
| Autodiscover | `/Autodiscover` | `/Autodiscover/healthcheck.htm` |

Use each service's health URI, expect HTTP 200, and set a bounded health interval/timeout. Confirm those probes against your Exchange installation. A working OWA probe cannot establish that EWS/MAPI is healthy. Microsoft describes [per-service monitoring and the healthcheck.htm endpoint](https://learn.microsoft.com/en-us/exchange/architecture/client-access/load-balancing). Avoid exposing management services such as PowerShell unless the deployment explicitly needs them; restrict ECP to the intended management audience.

For each handler, configure both mailbox-server addresses, the correct port (normally 443), upstream TLS, a validated certificate chain and the proper TLS server name. Use passive health/retries as appropriate alongside the active checks. Keep retries bounded and account for non-idempotent requests; replaying an already accepted POST can duplicate an operation. Test draining one server and losing a server mid-session.

## NTLM and connection behavior

Enable NTLM transport only for the endpoints/authentication modes that require it. NTLM binds authentication to a connection, so validate that concurrent users retain distinct authentication contexts and that connection reuse, HTTP versions and backend failover behave correctly. A completed login through one node is insufficient evidence. Preserve Exchange authorization headers and public hostnames, use suitable timeouts for long-lived MAPI/EWS/ActiveSync requests, and test Outlook desktop, OWA, mobile ActiveSync, EWS applications, OAB downloads and Autodiscover separately. Microsoft lists the [default virtual-directory authentication and TLS settings](https://learn.microsoft.com/en-us/exchange/clients/default-virtual-directory-settings).

## TLS and Extended Protection

Use end-to-end encryption. Microsoft states that **SSL offloading to plaintext is incompatible with Extended Protection**; HTTPS bridging is supported only when the load balancer and Exchange IIS front end use the **same SSL certificate**, otherwise channel-binding validation fails. Follow Microsoft's [Exchange Extended Protection requirements and certificate-renewal procedure](https://learn.microsoft.com/en-us/exchange/plan-and-deploy/post-installation-tasks/security-best-practices/exchange-extended-protection).

Import the matching certificate/private key on each proxy and all applicable Exchange IIS front ends, and coordinate renewal across the complete path. Validate the backend certificate chain and hostname; disabling verification is not a production solution. Use Microsoft's current Health Checker/Extended Protection tooling and account for hybrid-agent and public-folder exceptions in that documentation. Do not disable Extended Protection to make an unvalidated proxy design appear to work.

An L4 TLS passthrough deployment avoids terminating client TLS on the proxy and leaves certificate/authentication handling on Exchange, but cannot apply HTTP WAF inspection or per-path routing to encrypted traffic. Select the topology deliberately and test its service-level monitoring separately.

## Redundancy and migration acceptance

Run independent local app/database/certificate state on each proxy. Deploy equivalent listener, upstream, health, WAF, authentication and certificate settings to both. The DAG protects mailbox availability and does not provide the proxy VIP, proxy configuration replication or certificate coordination. Provide those through existing infrastructure and operations rather than sharing SQLite.

Before cutover, test every service and client against each proxy, a removed mailbox member, one failed service on an otherwise healthy member, VIP/proxy failover, authenticated concurrent sessions, certificate renewal and rollback. Observe backend TLS failures and health transitions. Keep the previous front end available for a controlled rollback. Tune WAF exclusions from observed legitimate Exchange traffic; generic attack tests alone cannot establish that Exchange requests remain usable.

For manual certificate rotation, upload the replacement certificate/key using new filenames, validate and switch configuration references, then retire the old files. Uploads reject collisions so that an in-use key cannot be silently overwritten.
