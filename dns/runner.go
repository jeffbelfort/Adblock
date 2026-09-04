package main

import (
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
)

func runDNS() {
	// Set up logging to file next to the exe
	setupLogging()

	log.Println("[adblock-dns] Starting...")

	cfg := loadConfig()

	bl := newBlocklist()
	if err := bl.loadAll(cfg.BlocklistDir); err != nil {
		log.Printf("[adblock-dns] Warning: could not load blocklists: %v", err)
	}
	log.Printf("[adblock-dns] Loaded %d blocked domains", bl.count())

	srv := newServer(cfg, bl)
	if err := srv.start(); err != nil {
		log.Fatalf("[adblock-dns] Failed to start: %v", err)
	}

	log.Printf("[adblock-dns] Listening on %s", cfg.ListenAddr)
	log.Printf("[adblock-dns] Upstream DNS: %s", cfg.UpstreamDNS)

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig

	log.Println("[adblock-dns] Shutting down...")
	srv.stop()
}

func setupLogging() {
	exePath, err := os.Executable()
	if err != nil {
		return
	}
	logPath := filepath.Join(filepath.Dir(exePath), "adblock-dns.log")
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	log.SetOutput(f)
	log.SetFlags(log.Ldate | log.Ltime)
}
