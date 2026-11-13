$ErrorActionPreference = 'Stop'
$frontend = Join-Path $PSScriptRoot '..\..\..\avinash\frontend'
$frontend = [IO.Path]::GetFullPath($frontend)
Set-Location -LiteralPath $frontend

if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Port 8000 is already in use. Stop the existing local server before restarting Matrix 360.'
}

# CLI 44 does not inject .env.local into raw Node functions. Import the
# Vercel-generated, git-ignored file without displaying any values.
$envFile = Join-Path $frontend '.env.local'
if (Test-Path -LiteralPath $envFile) {
    foreach ($line in Get-Content -LiteralPath $envFile) {
        if ($line -notmatch '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { continue }
        $name = $Matches[1]
        $raw = $Matches[2]
        $value = if ($raw.StartsWith('"')) { ConvertFrom-Json $raw } else { $raw }
        Set-Item -LiteralPath "Env:$name" -Value $value
    }
}

# Keep project link disabled for local execution so expired cloud tokens do not block dev startup.
$projectJson = Join-Path $frontend '.vercel\project.json'
$projectJsonDisabled = Join-Path $frontend '.vercel\project.json.disabled'
if (Test-Path -LiteralPath $projectJson) {
    Move-Item -LiteralPath $projectJson -Destination $projectJsonDisabled -Force
}

$env:NODE_OPTIONS = ''
$env:__VERCEL_SKIP_DEV_CMD = '1'
npx --yes vercel@44.7.3 dev --listen 127.0.0.1:8000
