<#
.SYNOPSIS
  Control the whole stack from Windows, where `make` usually is not installed.

.DESCRIPTION
  A thin wrapper over `docker compose` with the same verbs as the Makefile, so
  the commands in the README work on every machine on the team.

    .\scripts\stack.ps1 up          build every week from GitHub, start the stack
    .\scripts\stack.ps1 up-local    the same, on published ports, no Traefik
    .\scripts\stack.ps1 refs        what each running container was built from
    .\scripts\stack.ps1 logs
    .\scripts\stack.ps1 down

  The four week repositories are private, so the builds need a GitHub token.
  Set it once in this shell:

    $env:GIT_TOKEN = "ghp_..."

.PARAMETER Command
  up, up-local, build, pull, down, stop, restart, logs, ps, refs, health, test
#>
param(
    [Parameter(Position = 0)]
    [ValidateSet('up', 'up-local', 'build', 'pull', 'down', 'stop', 'restart',
                 'logs', 'ps', 'refs', 'health', 'test', 'help')]
    [string]$Command = 'help',

    [switch]$Local
)

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

# BuildKit is required: the week clones use `--mount=type=secret`, which the
# legacy builder does not understand.
$env:DOCKER_BUILDKIT = '1'
$env:COMPOSE_DOCKER_CLI_BUILD = '1'

if ($Local -and $Command -eq 'up') { $Command = 'up-local' }

$files = @('-f', 'docker-compose.yml')
if ($Command -eq 'up-local') { $files += @('-f', 'docker-compose.local.yml') }

function Invoke-Compose {
    param([string[]]$ComposeArgs)
    & docker compose @files @ComposeArgs
    if ($LASTEXITCODE -ne 0) { throw "docker compose exited with $LASTEXITCODE" }
}

function Show-Refs {
    Write-Host ''
    Write-Host '--- week sources baked into the running images ---'
    # Best effort per service: one that is not up must not fail the command.
    foreach ($svc in @(
            @{ name = 'analytics'; path = '/app/SOURCE_REF' },
            @{ name = 'debate';    path = '/SOURCE_REFS' },
            @{ name = 'knowledge'; path = '/SOURCE_REFS' })) {
        & docker compose @files exec -T $svc.name cat $svc.path 2>$null
        if ($LASTEXITCODE -ne 0) { Write-Host "$($svc.name): not running" }
    }
}

function Test-Token {
    if (-not $env:GIT_TOKEN) {
        Write-Warning 'GIT_TOKEN is not set. The week repositories are private, so the'
        Write-Warning "clones will fail with 'could not read Username'."
        Write-Warning '  $env:GIT_TOKEN = "ghp_..."   (a token with repo:read)'
    }
}

switch ($Command) {
    'help' {
        Get-Help $PSCommandPath -Detailed
    }
    'up' {
        Test-Token
        Invoke-Compose @('up', '-d', '--build')
        Show-Refs
    }
    'up-local' {
        Test-Token
        Invoke-Compose @('up', '-d', '--build')
        Show-Refs
        Write-Host ''
        Write-Host '  UI         http://localhost:5173'
        Write-Host '  debate     http://localhost:8100/docs'
        Write-Host '  analytics  http://localhost:8000/docs'
        Write-Host '  knowledge  http://localhost:8200'
    }
    'build'   { Test-Token; Invoke-Compose @('build') }
    'pull'    { Test-Token; Invoke-Compose @('build', '--no-cache', 'analytics', 'debate', 'knowledge') }
    'down'    { Invoke-Compose @('down') }
    'stop'    { Invoke-Compose @('stop') }
    'restart' { Invoke-Compose @('restart') }
    'logs'    { Invoke-Compose @('logs', '-f', '--tail=100') }
    'ps'      { Invoke-Compose @('ps') }
    'refs'    { Show-Refs }
    'health'  {
        foreach ($svc in @(
                @{ name = 'debate';    port = 8100 },
                @{ name = 'analytics'; port = 8000 })) {
            & docker compose @files exec -T $svc.name python -c "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:$($svc.port)/health',timeout=5).read().decode())" 2>$null
            if ($LASTEXITCODE -ne 0) { Write-Host "$($svc.name): unreachable" }
        }
    }
    'test'    { & python -m pytest services/debate/tests -q }
}
