# Schedule the private security monitor

On Windows, run the task under a dedicated operator account. Under that account,
create an ACL-restricted folder outside the repo and store the service key using
Windows DPAPI. Enter the key at the credential dialog. Keep the file and the log
accessible only to the task account and designated operators.

```powershell
Get-Credential -UserName 'service_role' -Message 'Supabase monitor service key' |
  Export-Clixml -LiteralPath 'C:\Restricted\BantaiMonitor\credential.xml'
```

Create a Windows Task Scheduler task repeating every **15 minutes**. Select
**Do not start a new instance** as its overlap policy. Run PowerShell with these
arguments, substituting your verified paths and Supabase origin:

```text
-NoProfile -NonInteractive -File "D:\Projects\Bantai\supabase\scripts\run-security-monitor.ps1" -SupabaseUrl "https://your-project.supabase.co" -CredentialFile "C:\Restricted\BantaiMonitor\credential.xml" -LogFile "C:\Restricted\BantaiMonitor\runs.log"
```

Run once against a disposable database first. Verify that the task history shows
exit code zero and the log shows a timestamped success. Use an invalid local
credential to verify a nonzero result and a redacted failure entry. Monitor task
history and the last successful timestamp for missed or failed runs. Configure
log retention through the operator's existing log retention process.

The runner uses the existing service-only RPC. Its flag uniqueness and
Philippine calendar-day grouping apply even if two jobs overlap. Keep both
scripts outside public frontend output and HTTP routes. The credential has
service-role authority and must stay on the operator host.


## Schedule security email alerts

Create a second DPAPI credential file under the same task account for a Brevo
transactional API key. Configure a separate task repeating every minute with
**Do not start a new instance** and the following PowerShell arguments:

```text
-NoProfile -NonInteractive -File "D:\Projects\Bantai\supabase\scripts\run-security-monitor.ps1" -Kind alerts -SupabaseUrl "https://your-project.supabase.co" -CredentialFile "C:\Restricted\BantaiMonitor\credential.xml" -BrevoCredentialFile "C:\Restricted\BantaiMonitor\brevo.xml" -SenderEmail "verified-sender@example.org" -AppOrigin "https://your-bantai-frontend.example" -LogFile "C:\Restricted\BantaiMonitor\alerts.log"
```

Check that Node is on the task account's PATH. Stop older alert workers before
switching versions. A nonzero task result or missing recent success needs
operator review. Query only queue status and last_error for troubleshooting.
The worker retries explicit 429 responses. Timeouts, ambiguous provider
responses and abandoned leases stop automatic retry. Check the Brevo
transactional logs before considering a manual resend. ALERT_EMAIL_SENT means
provider acceptance. Use Brevo delivery logs or an approved test inbox to
verify delivery. Supabase Auth continues sending its native password-change
notification.
