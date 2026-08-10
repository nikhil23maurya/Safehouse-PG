param(
  [Parameter(Mandatory=$true)][string]$BaseUrl,
  [Parameter(Mandatory=$true)][string]$Email,
  [Parameter(Mandatory=$true)][string]$Password
)

$BaseUrl = $BaseUrl.TrimEnd('/')
Write-Host "1) Health"
Invoke-RestMethod "$BaseUrl/health" | ConvertTo-Json

Write-Host "2) Database readiness"
Invoke-RestMethod "$BaseUrl/ready" | ConvertTo-Json

Write-Host "3) Owner login"
$login = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/auth/login" -ContentType "application/json" -Body (@{email=$Email;password=$Password} | ConvertTo-Json)
$token = $login.tokens.accessToken
Write-Host "Logged in as $($login.user.fullName)"

Write-Host "4) Dashboard"
Invoke-RestMethod -Uri "$BaseUrl/api/owner/dashboard" -Headers @{Authorization="Bearer $token"} | ConvertTo-Json -Depth 8
