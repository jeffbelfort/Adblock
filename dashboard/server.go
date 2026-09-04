package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

var dnsLogPath string
var dnsBlocklistDir string
var dnsBinaryPath string

func runDashboard() {
	setupPaths()
	setupLogging()

	log.Println("[adblock-dashboard] Starting on http://localhost:9001")

	mux := http.NewServeMux()
	webDir := filepath.Join(exeDir(), "web")
	mux.Handle("/", http.FileServer(http.Dir(webDir)))

	mux.HandleFunc("/api/status", handleStatus)
	mux.HandleFunc("/api/dns/start", handleDNSStart)
	mux.HandleFunc("/api/dns/stop", handleDNSStop)
	mux.HandleFunc("/api/dns/logs", handleDNSLogs)
	mux.HandleFunc("/api/dns/history", handleDNSHistory)
	mux.HandleFunc("/api/dns/graph", handleDNSGraph)
	mux.HandleFunc("/api/blocklists", handleBlocklists)
	mux.HandleFunc("/api/blocklists/add", handleAddDomain)

	srv := &http.Server{
		Addr:    "127.0.0.1:9001",
		Handler: corsMiddleware(mux),
	}

	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("[adblock-dashboard] Server error: %v", err)
	}
}

func setupPaths() {
	cfgPath := filepath.Join(exeDir(), "config.json")
	data, err := os.ReadFile(cfgPath)
	if err == nil {
		var cfg struct {
			DNSDir string `json:"dns_dir"`
		}
		if json.Unmarshal(data, &cfg) == nil && cfg.DNSDir != "" {
			dnsLogPath = filepath.Join(cfg.DNSDir, "adblock-dns.log")
			dnsBlocklistDir = filepath.Join(cfg.DNSDir, "blocklists")
			dnsBinaryPath = filepath.Join(cfg.DNSDir, "AdblockDNS.exe")
			log.Printf("[adblock-dashboard] DNS dir: %s", cfg.DNSDir)
			return
		}
	}
	base := filepath.Dir(exeDir())
	dnsLogPath = filepath.Join(base, "dns", "adblock-dns.log")
	dnsBlocklistDir = filepath.Join(base, "dns", "blocklists")
	dnsBinaryPath = filepath.Join(base, "dns", "AdblockDNS.exe")
}

func exeDir() string {
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	return filepath.Dir(exe)
}

func setupLogging() {
	logPath := filepath.Join(exeDir(), "adblock-dashboard.log")
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	log.SetOutput(f)
	log.SetFlags(log.Ldate | log.Ltime)
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

func handleStatus(w http.ResponseWriter, r *http.Request) {
	dnsRunning := isDNSRunning()
	blockedToday := countBlockedToday()
	blockedTotal := countBlockedTotal()
	domainCount := countLoadedDomains()

	writeJSON(w, map[string]interface{}{
		"dns_running":    dnsRunning,
		"blocked_today":  blockedToday,
		"blocked_total":  blockedTotal,
		"domain_count":   domainCount,
		"timestamp":      time.Now().Unix(),
	})
}

func handleDNSStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	cmd := exec.Command(dnsBinaryPath, "start")
	if err := cmd.Run(); err != nil {
		writeJSON(w, map[string]interface{}{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, map[string]interface{}{"ok": true})
}

func handleDNSStop(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	cmd := exec.Command(dnsBinaryPath, "stop")
	if err := cmd.Run(); err != nil {
		writeJSON(w, map[string]interface{}{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, map[string]interface{}{"ok": true})
}

// handleDNSLogs returns recent unique blocked domains
func handleDNSLogs(w http.ResponseWriter, r *http.Request) {
	entries := getBlockedEntries(500)
	// Deduplicate: keep only most recent occurrence of each domain per minute
	seen := make(map[string]bool)
	var deduped []map[string]string
	for i := len(entries) - 1; i >= 0; i-- {
		e := entries[i]
		key := e["domain"] + "|" + e["time"][:13] // domain + hour:minute
		if !seen[key] {
			seen[key] = true
			deduped = append([]map[string]string{e}, deduped...)
		}
	}
	// Return last 100
	if len(deduped) > 100 {
		deduped = deduped[len(deduped)-100:]
	}
	if deduped == nil {
		deduped = []map[string]string{}
	}
	writeJSON(w, deduped)
}

// handleDNSHistory returns full block history for the history page
func handleDNSHistory(w http.ResponseWriter, r *http.Request) {
	entries := getBlockedEntries(5000)

	// Count by domain
	domainCount := make(map[string]int)
	for _, e := range entries {
		domainCount[e["domain"]]++
	}

	type domainStat struct {
		Domain string `json:"domain"`
		Count  int    `json:"count"`
	}
	var stats []domainStat
	for d, c := range domainCount {
		stats = append(stats, domainStat{Domain: d, Count: c})
	}
	sort.Slice(stats, func(i, j int) bool {
		return stats[i].Count > stats[j].Count
	})

	writeJSON(w, map[string]interface{}{
		"entries":     entries,
		"top_domains": stats,
	})
}

// handleDNSGraph returns blocks per hour for the last 24 hours
func handleDNSGraph(w http.ResponseWriter, r *http.Request) {
	entries := getBlockedEntries(10000)

	// Count blocks per hour for last 24 hours
	now := time.Now()
	hours := make(map[string]int)
	labels := make([]string, 24)
	values := make([]int, 24)

	for i := 23; i >= 0; i-- {
		t := now.Add(time.Duration(-i) * time.Hour)
		key := t.Format("2006/01/02 15")
		label := t.Format("15:00")
		labels[23-i] = label
		hours[key] = 0
	}

	for _, e := range entries {
		// e["time"] format: "2006/01/02 15:04:05"
		if len(e["time"]) >= 13 {
			key := e["time"][:13]
			if _, ok := hours[key]; ok {
				hours[key]++
			}
		}
	}

	for i := 23; i >= 0; i-- {
		t := now.Add(time.Duration(-i) * time.Hour)
		key := t.Format("2006/01/02 15")
		values[23-i] = hours[key]
	}

	writeJSON(w, map[string]interface{}{
		"labels": labels,
		"values": values,
	})
}

func handleBlocklists(w http.ResponseWriter, r *http.Request) {
	files, err := filepath.Glob(filepath.Join(dnsBlocklistDir, "*.txt"))
	if err != nil {
		writeJSON(w, []interface{}{})
		return
	}
	var lists []map[string]interface{}
	for _, f := range files {
		count := countDomainsInFile(f)
		lists = append(lists, map[string]interface{}{
			"name":  filepath.Base(f),
			"count": count,
		})
	}
	if lists == nil {
		lists = []map[string]interface{}{}
	}
	writeJSON(w, lists)
}

func handleAddDomain(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		Domain string `json:"domain"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, map[string]interface{}{"ok": false, "error": "invalid JSON"})
		return
	}
	domain := strings.TrimSpace(strings.ToLower(body.Domain))
	if domain == "" {
		writeJSON(w, map[string]interface{}{"ok": false, "error": "empty domain"})
		return
	}
	customPath := filepath.Join(dnsBlocklistDir, "custom.txt")
	f, err := os.OpenFile(customPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		writeJSON(w, map[string]interface{}{"ok": false, "error": err.Error()})
		return
	}
	defer f.Close()
	fmt.Fprintf(f, "%s\n", domain)
	writeJSON(w, map[string]interface{}{"ok": true, "domain": domain})
}

func getBlockedEntries(maxLines int) []map[string]string {
	lines := readLastNLines(dnsLogPath, maxLines)
	var entries []map[string]string
	for _, line := range lines {
		if strings.Contains(line, "[BLOCKED]") {
			parts := strings.SplitN(line, "[BLOCKED] ", 2)
			if len(parts) == 2 {
				entries = append(entries, map[string]string{
					"domain": strings.TrimSpace(parts[1]),
					"time":   strings.TrimSpace(parts[0]),
				})
			}
		}
	}
	return entries
}

func isDNSRunning() bool {
	cmd := exec.Command("sc", "query", "AdblockDNS")
	out, err := cmd.Output()
	if err != nil {
		return false
	}
	return strings.Contains(string(out), "RUNNING")
}

func countBlockedToday() int {
	today := time.Now().Format("2006/01/02")
	entries := getBlockedEntries(10000)
	count := 0
	for _, e := range entries {
		if strings.HasPrefix(e["time"], today) {
			count++
		}
	}
	return count
}

func countBlockedTotal() int {
	return len(getBlockedEntries(100000))
}

func countLoadedDomains() int {
	// Scan entire log file for last "Loaded X blocked domains" line
	f, err := os.Open(dnsLogPath)
	if err != nil {
		return 0
	}
	defer f.Close()
	result := 0
	scanner := bufio.NewScanner(f)
	buf := make([]byte, 10*1024*1024)
	scanner.Buffer(buf, len(buf))
	for scanner.Scan() {
		line := scanner.Text()
		if strings.Contains(line, "blocked domains") && strings.Contains(line, "Loaded") {
			fields := strings.Fields(line)
			for j, field := range fields {
				if field == "Loaded" && j+1 < len(fields) {
					var n int
					fmt.Sscanf(fields[j+1], "%d", &n)
					if n > 0 {
						result = n
					}
				}
			}
		}
	}
	return result
}

func countDomainsInFile(path string) int {
	f, err := os.Open(path)
	if err != nil {
		return 0
	}
	defer f.Close()
	count := 0
	scanner := bufio.NewScanner(f)
	buf := make([]byte, 10*1024*1024)
	scanner.Buffer(buf, len(buf))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line != "" && !strings.HasPrefix(line, "#") {
			count++
		}
	}
	return count
}

func readLastNLines(path string, n int) []string {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	var lines []string
	scanner := bufio.NewScanner(f)
	buf := make([]byte, 10*1024*1024)
	scanner.Buffer(buf, len(buf))
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}
	if len(lines) <= n {
		return lines
	}
	return lines[len(lines)-n:]
}
