# 🔧 Troubleshooting Network Docker untuk Suwayomi

## ✅ Cara Memastikan Network Docker Benar

### 1. **Cek Status Container**
```bash
# Cek apakah kedua container berjalan
docker ps

# Harus muncul:
# - my-discord-bot
# - soulscans_suwayomi
```

### 2. **Cek Network yang Digunakan**
```bash
# Lihat network yang dibuat oleh docker-compose
docker network ls

# Cek detail network (ganti NAMA_NETWORK dengan nama yang muncul)
docker network inspect NAMA_NETWORK

# Atau langsung cek network dari container
docker inspect my-discord-bot | grep -A 10 "Networks"
docker inspect soulscans_suwayomi | grep -A 10 "Networks"
```

### 3. **Test Koneksi dari Bot ke Suwayomi**
```bash
# Masuk ke container bot
docker exec -it my-discord-bot sh

# Test koneksi ke Suwayomi (dari dalam container bot)
# Opsi 1: Test dengan ping (jika tersedia)
ping suwayomi

# Opsi 2: Test dengan curl/wget
curl http://suwayomi:4567/api/v1/source/list
# atau
wget -O- http://suwayomi:4567/api/v1/source/list

# Opsi 3: Test dengan node (jika node tersedia)
node -e "require('http').get('http://suwayomi:4567/api/v1/source/list', (r) => console.log(r.statusCode))"
```

### 4. **Restart dengan Network Baru**
Jika masih bermasalah, restart semua container:
```bash
# Stop semua container
docker-compose down

# Start ulang (akan membuat network baru jika belum ada)
docker-compose up -d

# Cek log untuk memastikan tidak ada error
docker-compose logs discord-bot
docker-compose logs suwayomi
```

## 🐛 Masalah Umum & Solusi

### Masalah 1: "ECONNREFUSED" atau "Cannot connect to Suwayomi"
**Solusi:**
1. Pastikan container Suwayomi berjalan: `docker ps | grep suwayomi`
2. Pastikan Suwayomi sudah siap (tunggu 10-30 detik setelah start)
3. Test dari dalam container bot: `docker exec -it my-discord-bot curl http://suwayomi:4567/api/v1/source/list`

### Masalah 2: "Name resolution failed" atau "Host not found"
**Solusi:**
1. Pastikan kedua container dalam network yang sama
2. Gunakan service name `suwayomi` (bukan container name `soulscans_suwayomi`)
3. Restart dengan `docker-compose down && docker-compose up -d`

### Masalah 3: Container tidak dalam network yang sama
**Solusi:**
1. Hapus network lama: `docker network prune`
2. Restart semua: `docker-compose down && docker-compose up -d`
3. Atau tambahkan manual: `docker network connect NAMA_NETWORK my-discord-bot`

## 🔍 Verifikasi Akhir

Setelah semua langkah di atas, test command bot:
```
/suwayomi refresh-repo
```

Jika berhasil, berarti network sudah benar! ✅

