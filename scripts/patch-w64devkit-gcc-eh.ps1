#requires -Version 5.1
# Patch w64devkit so Rust's x86_64-pc-windows-gnu target can link.
# GCC 14+ removed libgcc_eh.a (libgcc now contains the EH frame code directly),
# but Rust 1.96's prebuilt rlibs still pass -lgcc_eh. Create an empty stub.

$ErrorActionPreference = 'Stop'
$w64 = Join-Path $env:USERPROFILE 'w64devkit\w64devkit'
$libDir = Join-Path $w64 'lib'
if (-not (Test-Path $libDir)) { throw "lib dir not found: $libDir" }

$dummyC = Join-Path $env:TEMP 'w64_dummy.c'
$dummyO = Join-Path $env:TEMP 'w64_dummy.o'
Set-Content -Path $dummyC -Value '__attribute__((used)) static int __gcc_eh_dummy = 0;' -Encoding ASCII

$gcc = Join-Path $w64 'bin\gcc.exe'
& $gcc -c $dummyC -o $dummyO
if (-not (Test-Path $dummyO)) { throw "gcc failed to produce dummy.o" }

$ar = Join-Path $w64 'bin\ar.exe'
$target = Join-Path $libDir 'libgcc_eh.a'
& $ar rcs $target $dummyO
if (-not (Test-Path $target)) { throw "ar failed to create $target" }

Remove-Item $dummyC, $dummyO -ErrorAction SilentlyContinue
$item = Get-Item $target
Write-Output "OK: $target ($($item.Length) bytes)"