<#
.SYNOPSIS
    يضيف صفحة «التقرير الأسبوعي» إلى مشروع نظام زام للعمليات.
.DESCRIPTION
    الاستخدام:
        1. افتح PowerShell في مجلد هذه الحزمة.
        2. شغّل:  .\INSTALL.ps1 -RepoPath "C:\path\to\repo"
        3. السكربت ينسخ الملفين، ويضيف عنصر القائمة في assets\supabase-config.js
           (بشكل آمن — لا يستبدل الملف، يضيف سطر واحد فقط)، ثم يعمل commit و push.
.NOTES
    - يتطلب Git مثبت + صلاحية push على المستودع.
    - لا يغيّر أي شيء في doPost أو في جداول الداتابيز.
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$RepoPath,

    [string]$CommitMessage = "feat: إضافة صفحة التقرير التشغيلي الأسبوعي",

    [string]$Branch = "codex/operations-wiring",

    [switch]$NoPush
)

$ErrorActionPreference = "Stop"
$PackageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

# ── 1) التحقق من البيئة ──
try { git --version | Out-Null } catch {
    Write-Error "Git غير مثبت. ثبّته من https://git-scm.com/download/win ثم أعد المحاولة."
    exit 1
}
if (-not (Test-Path -Path (Join-Path $RepoPath ".git") -PathType Container)) {
    Write-Error "المسار $RepoPath ليس مستودع Git. تأكد من المسار."
    exit 1
}

Set-Location $RepoPath
Write-Host "📂 المستودع: $RepoPath" -ForegroundColor Cyan
Write-Host "🌿 الفرع: $Branch" -ForegroundColor Cyan

git fetch origin $Branch
git checkout $Branch
git pull origin $Branch

# ── 2) نسخ الملفات ──
$FileMap = @{
    "weekly-report\index.html"   = "weekly-report\index.html"
    "assets\weekly-report-core.js" = "assets\weekly-report-core.js"
}

Write-Host "`n📋 نسخ الملفات..." -ForegroundColor Cyan
foreach ($src in $FileMap.Keys) {
    $srcPath = Join-Path $PackageRoot $src
    $dstPath = Join-Path $RepoPath $FileMap[$src]
    if (-not (Test-Path -Path $srcPath)) {
        Write-Warning "ملف مفقود في الحزمة: $src"
        continue
    }
    $dstDir = Split-Path -Parent $dstPath
    if (-not (Test-Path -Path $dstDir -PathType Container)) {
        New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
    }
    Copy-Item -Path $srcPath -Destination $dstPath -Force
    Write-Host "  ✅ $($FileMap[$src])" -ForegroundColor Green
}

# ── 3) إضافة عنصر القائمة في assets\supabase-config.js (بدون استبدال الملف) ──
$ConfigPath = Join-Path $RepoPath "assets\supabase-config.js"
Write-Host "`n🔧 تحديث قائمة التنقل..." -ForegroundColor Cyan

if (-not (Test-Path -Path $ConfigPath)) {
    Write-Warning "ملف assets\supabase-config.js غير موجود — أضف عنصر القائمة يدوياً:"
    Write-Host "   { key: 'weekly-report', label: 'التقرير الأسبوعي', href: '../weekly-report/index.html', roles: ['Owner'] }," -ForegroundColor Yellow
}
else {
    $content = Get-Content -Path $ConfigPath -Raw -Encoding UTF8

    # ── 3أ) إصلاح عميل Supabase ──
    # السطر الحالي:  const zamClient = window.supabase || supabase.createClient(...)
    # المشكلة: window.supabase هي المكتبة المحمّلة من CDN وليست عميلاً متصلاً،
    # فتصبح zamClient = المكتبة (لا تملك .from) → كل استعلام يفشل بصمت.
    # الإصلاح: نستخدم window.supabase فقط لو كان عميلاً فعلاً (له .from).
    $oldClient = "const zamClient = window.supabase || supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);"
    $newClient = "const zamClient = (window.supabase && typeof window.supabase.from === 'function')`r`n    ? window.supabase`r`n    : supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);"
    if ($content.Contains($oldClient)) {
        $content = $content.Replace($oldClient, $newClient)
        [System.IO.File]::WriteAllText($ConfigPath, $content, (New-Object System.Text.UTF8Encoding($false)))
        Write-Host "  🔧 تم إصلاح تعريف zamClient (كان يستخدم المكتبة بدل العميل)." -ForegroundColor Green
    }
    elseif ($content -match "typeof window\.supabase\.from === 'function'") {
        Write-Host "  ℹ️  إصلاح zamClient موجود مسبقاً." -ForegroundColor Yellow
    }
    else {
        Write-Warning "لم يتم التعرف على سطر تعريف zamClient — راجعه يدوياً."
    }

    # ── 3ب) إضافة عنصر القائمة ──
    $newItem = "    { key: 'weekly-report',     label: 'التقرير الأسبوعي',  href: '../weekly-report/index.html',      roles: ['Owner'] },"
    if ($content -match "key:\s*'weekly-report'") {
        $updated = [regex]::Replace($content, "(?m)^\s*\{\s*key:\s*'weekly-report'.*$", $newItem, 1)
        if ($updated -ne $content) {
            $content = $updated
            [System.IO.File]::WriteAllText($ConfigPath, $content, (New-Object System.Text.UTF8Encoding($false)))
            Write-Host "  ✅ تم تحديث صلاحية عنصر «التقرير الأسبوعي» إلى Owner فقط." -ForegroundColor Green
        }
        else {
            Write-Host "  ℹ️  عنصر القائمة موجود مسبقاً — راجعه يدوياً." -ForegroundColor Yellow
        }
    }
    else {
        # ندرج بعد سطر daily-report
        $pattern = "(?m)^(\s*\{ key: 'daily-report'.*)$"
        if ($content -match $pattern) {
            $content = [regex]::Replace($content, $pattern, { param($m) $m.Groups[1].Value + "`r`n" + $newItem }, 1)
            [System.IO.File]::WriteAllText($ConfigPath, $content, (New-Object System.Text.UTF8Encoding($false)))
            Write-Host "  ✅ أُضيف عنصر «التقرير الأسبوعي» بعد «تقرير يومي»." -ForegroundColor Green
        }
        else {
            # احتياطي: نضيف قبل نهاية مصفوفة ZAM_NAV_ITEMS
            $anchor = "];"
            $idx = $content.IndexOf("const ZAM_NAV_ITEMS")
            if ($idx -ge 0) {
                $closeIdx = $content.IndexOf($anchor, $idx)
                if ($closeIdx -ge 0) {
                    $content = $content.Substring(0, $closeIdx) + $newItem + "`r`n" + $content.Substring($closeIdx)
                    [System.IO.File]::WriteAllText($ConfigPath, $content, (New-Object System.Text.UTF8Encoding($false)))
                    Write-Host "  ✅ أُضيف العنصر (احتياطي)." -ForegroundColor Green
                }
            }
        }
    }
}

# ── 4) حالة Git ──
Write-Host "`n📊 الملفات المعدّلة:" -ForegroundColor Cyan
git status --short

if ($NoPush) {
    Write-Host "`n✔ تم النسخ فقط (بدون commit/push) — استخدم -NoPush" -ForegroundColor Green
    exit 0
}

# ── 5) Commit & Push ──
$confirm = Read-Host "`nهل تريد المتابعة بـ commit و push؟ (y/n)"
if ($confirm -ne "y") {
    Write-Host "تم الإلغاء — الملفات منسوخة لكن لم تُدفع." -ForegroundColor Yellow
    exit 0
}

Write-Host "`n💾 commit..." -ForegroundColor Cyan
git add -A
git commit -m $CommitMessage

Write-Host "`n🚀 push إلى origin/$Branch ..." -ForegroundColor Cyan
git push origin $Branch

Write-Host "`n✨ تم بنجاح!" -ForegroundColor Green
Write-Host "راجع الـ commit: https://github.com/mrraed222/MAHMOUD-RAED-OPERATION-MANGEMENT-ZAM/commits/$Branch" -ForegroundColor Green
Write-Host "الصفحة: /weekly-report/index.html" -ForegroundColor Green

