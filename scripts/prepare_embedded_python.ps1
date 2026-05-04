param(
    [Parameter(Mandatory = $false)]
    [string]$SourcePythonRoot = $env:pythonLocation,

    [Parameter(Mandatory = $false)]
    [string]$TargetRelativePath = "python\\python-3.12.8-embed-amd64",

    [Parameter(Mandatory = $false)]
    [string]$RequirementsRelativePath = "python\\requirements.txt",

    [Parameter(Mandatory = $false)]
    [string]$XtQuantPackageUrl = $env:XTQUANT_PACKAGE_URL
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "[prepare-embedded-python] $Message"
}

function Copy-DirectoryContents {
    param(
        [string]$Source,
        [string]$Destination
    )

    # Robocopy returns non-zero codes for successful copy operations, so we
    # explicitly treat values below 8 as success.
    $null = robocopy $Source $Destination /MIR /XD "__pycache__" "test" "tests" "ensurepip\\_bundled" /XF "*.pyc" "*.pyo"
    if ($LASTEXITCODE -ge 8) {
        throw "Robocopy failed with exit code $LASTEXITCODE."
    }
}

function Install-XtQuantPackage {
    param(
        [string]$PythonExe,
        [string]$SitePackagesPath,
        [string]$PackageUrl,
        [string]$WorkingDirectory
    )

    if ([string]::IsNullOrWhiteSpace($PackageUrl)) {
        Write-Step "XTQUANT_PACKAGE_URL is not set. Skipping optional xtquant restore."
        return
    }

    $downloadName = Split-Path -Path $PackageUrl -Leaf
    if ([string]::IsNullOrWhiteSpace($downloadName)) {
        $downloadName = "xtquant-package.zip"
    }

    $downloadPath = Join-Path $WorkingDirectory $downloadName
    Write-Step "Downloading optional xtquant package from $PackageUrl"
    Invoke-WebRequest -Uri $PackageUrl -OutFile $downloadPath

    $extension = [System.IO.Path]::GetExtension($downloadPath).ToLowerInvariant()
    if ($extension -eq ".whl") {
        Write-Step "Installing xtquant wheel into the embedded runtime"
        & $PythonExe -m pip install --no-warn-script-location $downloadPath
        return
    }

    if ($extension -eq ".zip") {
        Write-Step "Extracting xtquant archive into site-packages"
        Expand-Archive -Path $downloadPath -DestinationPath $SitePackagesPath -Force
        return
    }

    throw "Unsupported XTQUANT package type: $extension"
}

if ([string]::IsNullOrWhiteSpace($SourcePythonRoot)) {
    throw "SourcePythonRoot is empty. Run this script after actions/setup-python or pass -SourcePythonRoot explicitly."
}

$projectRoot = Split-Path -Path $PSScriptRoot -Parent
$resolvedSourceRoot = (Resolve-Path $SourcePythonRoot).Path
$targetRoot = Join-Path $projectRoot $TargetRelativePath
$requirementsPath = Join-Path $projectRoot $RequirementsRelativePath
$targetPythonExe = Join-Path $targetRoot "python.exe"
$sitePackagesPath = Join-Path $targetRoot "Lib\\site-packages"
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("embedded-python-" + [System.Guid]::NewGuid().ToString("N"))

Write-Step "Preparing embedded runtime from $resolvedSourceRoot"
Write-Step "Target runtime directory: $targetRoot"

if (Test-Path $tempRoot) {
    Remove-Item -Path $tempRoot -Recurse -Force
}
New-Item -Path $tempRoot -ItemType Directory -Force | Out-Null

try {
    if (Test-Path $targetRoot) {
        Write-Step "Removing stale target runtime"
        Remove-Item -Path $targetRoot -Recurse -Force
    }

    New-Item -Path $targetRoot -ItemType Directory -Force | Out-Null
    Copy-DirectoryContents -Source $resolvedSourceRoot -Destination $targetRoot

    if (-not (Test-Path $targetPythonExe)) {
        throw "python.exe was not found in the prepared runtime."
    }

    if (-not (Test-Path $sitePackagesPath)) {
        New-Item -Path $sitePackagesPath -ItemType Directory -Force | Out-Null
    }

    Write-Step "Upgrading pip in the packaged runtime"
    & $targetPythonExe -m pip install --upgrade pip

    if (Test-Path $requirementsPath) {
        Write-Step "Installing base Python requirements"
        & $targetPythonExe -m pip install --no-warn-script-location -r $requirementsPath
    }
    else {
        Write-Step "No python/requirements.txt found. Skipping base package install."
    }

    Install-XtQuantPackage -PythonExe $targetPythonExe -SitePackagesPath $sitePackagesPath -PackageUrl $XtQuantPackageUrl -WorkingDirectory $tempRoot
    Write-Step "Embedded runtime is ready."
}
finally {
    if (Test-Path $tempRoot) {
        Remove-Item -Path $tempRoot -Recurse -Force
    }
}
