param([string]$Model = "all")
# ดาวน์โหลด GGUF มาเป็นของโปรเจ็ก — รันครั้งเดียว

$models = @{
  gemma3 = @{ url = "https://huggingface.co/unsloth/gemma-3-4b-it-GGUF/resolve/main/gemma-3-4b-it-Q4_K_M.gguf"; file = "gemma3-4b-it-Q4_K_M.gguf" }
  qwen3  = @{ url = "https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/qwen3-8b-q4_k_m.gguf"; file = "qwen3-8b-Q4_K_M.gguf" }
}

$targets = if ($Model -eq "all") { $models.Keys } else { @($Model) }

foreach ($k in $targets) {
  if (-not $models.ContainsKey($k)) { Write-Host "Unknown model: $k (เลือก: gemma3, qwen3, all)"; continue }
  $m = $models[$k]
  $dest = Join-Path $PSScriptRoot $m.file
  if (Test-Path $dest) { Write-Host "มีแล้ว: $($m.file) — ข้าม"; continue }
  Write-Host "ดาวน์โหลด $($m.file) จาก $($m.url) ..."
  # ใช้ curl แบบ resume ได้
  curl.exe -L --progress-bar -o $dest $m.url
  if (Test-Path $dest) { Write-Host "เสร็จ: $dest" } else { Write-Host "ล้มเหลว: $k" }
}
Write-Host "เสร็จ — ไฟล์ GGUF อยู่ใน sovereign-os/core-api/models/"
