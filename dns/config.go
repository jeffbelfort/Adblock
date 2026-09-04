package main

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
)

type config struct {
	ListenAddr   string `json:"listen"`
	UpstreamDNS  string `json:"upstream"`
	BlocklistDir string `json:"blocklist_dir"`
	CacheTTL     int    `json:"cache_ttl"`
}

func loadConfig() *config {
	cfg := &config{
		ListenAddr:   "127.0.0.1:53",
		UpstreamDNS:  "1.1.1.1:53",
		BlocklistDir: defaultBlocklistDir(),
		CacheTTL:     300,
	}

	cfgPath := filepath.Join(exeDir(), "config.json")
	data, err := os.ReadFile(cfgPath)
	if err != nil {
		log.Printf("[adblock-dns] No config.json found, using defaults")
		return cfg
	}

	if err := json.Unmarshal(data, cfg); err != nil {
		log.Printf("[adblock-dns] Could not parse config.json: %v — using defaults", err)
		return cfg
	}

	log.Printf("[adblock-dns] Config loaded from %s", cfgPath)
	return cfg
}

func exeDir() string {
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	return filepath.Dir(exe)
}

func defaultBlocklistDir() string {
	return filepath.Join(exeDir(), "blocklists")
}
