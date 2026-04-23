param(
  [Parameter(Mandatory = $true)][string]$SmtpHost,
  [Parameter(Mandatory = $true)][int]$Port,
  [Parameter(Mandatory = $true)][string]$Username,
  [Parameter(Mandatory = $true)][string]$Password,
  [Parameter(Mandatory = $true)][string]$From,
  [Parameter(Mandatory = $true)][string]$To,
  [Parameter(Mandatory = $true)][string]$Subject,
  [Parameter(Mandatory = $true)][string]$Body,
  [Parameter(Mandatory = $true)][string]$UseSsl
)

$useSslValue = $UseSsl.Trim().ToLowerInvariant()
$useSslEnabled = $useSslValue -in @("true", "1", "yes")

$securePassword = ConvertTo-SecureString $Password -AsPlainText -Force
$credential = New-Object System.Management.Automation.PSCredential($Username, $securePassword)

$message = New-Object System.Net.Mail.MailMessage
$message.From = $From
$To.Split(',') | ForEach-Object {
  $recipient = $_.Trim()
  if ($recipient) {
    [void]$message.To.Add($recipient)
  }
}

$message.Subject = $Subject
$message.Body = $Body
$message.IsBodyHtml = $false
$message.BodyEncoding = [System.Text.Encoding]::UTF8
$message.SubjectEncoding = [System.Text.Encoding]::UTF8

$client = New-Object System.Net.Mail.SmtpClient($SmtpHost, $Port)
$client.EnableSsl = $useSslEnabled
$client.Credentials = $credential
$client.DeliveryMethod = [System.Net.Mail.SmtpDeliveryMethod]::Network

try {
  $client.Send($message)
  Write-Output "OK"
} finally {
  $message.Dispose()
  $client.Dispose()
}
