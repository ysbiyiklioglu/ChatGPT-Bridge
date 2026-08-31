param(
    [Parameter(Mandatory=$true)]
    [string]$Message,
    [int]$Timeout = 60000
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$body = @{ message = $Message; timeout = $Timeout } | ConvertTo-Json
try {
    $result = Invoke-RestMethod -Uri "http://127.0.0.1:3000/send" -Method POST -Body $body -ContentType "application/json; charset=utf-8" -TimeoutSec (($Timeout/1000) + 5)
    Write-Output $result.response
} catch {
    Write-Output "HATA: $($_.Exception.Message)"
}
