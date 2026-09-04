package main

import (
	"bufio"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type blocklist struct {
	mu      sync.RWMutex
	domains map[string]struct{}
}

func newBlocklist() *blocklist {
	return &blocklist{
		domains: make(map[string]struct{}),
	}
}

func (b *blocklist) loadAll(dir string) error {
	files, err := filepath.Glob(filepath.Join(dir, "*.txt"))
	if err != nil {
		return err
	}
	if len(files) == 0 {
		log.Printf("[adblock-dns] No blocklist files found in %s", dir)
		return nil
	}
	for _, f := range files {
		n, err := b.loadFile(f)
		if err != nil {
			log.Printf("[adblock-dns] Skipping %s: %v", f, err)
			continue
		}
		log.Printf("[adblock-dns] Loaded %d domains from %s", n, filepath.Base(f))
	}
	return nil
}

func (b *blocklist) loadFile(path string) (int, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()

	b.mu.Lock()
	defer b.mu.Unlock()

	count := 0
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if idx := strings.Index(line, "#"); idx != -1 {
			line = strings.TrimSpace(line[:idx])
		}

		fields := strings.Fields(line)
		var domain string

		switch len(fields) {
		case 1:
			domain = fields[0]
		case 2:
			ip := fields[0]
			if ip == "0.0.0.0" || ip == "127.0.0.1" {
				domain = fields[1]
			} else {
				continue
			}
		default:
			continue
		}

		domain = strings.ToLower(strings.TrimSuffix(domain, "."))
		if domain == "localhost" || domain == "local" || domain == "" {
			continue
		}

		b.domains[domain] = struct{}{}
		count++
	}
	return count, scanner.Err()
}

func (b *blocklist) isBlocked(domain string) bool {
	domain = strings.ToLower(strings.TrimSuffix(domain, "."))

	b.mu.RLock()
	defer b.mu.RUnlock()

	if _, ok := b.domains[domain]; ok {
		return true
	}

	for {
		idx := strings.Index(domain, ".")
		if idx == -1 {
			break
		}
		domain = domain[idx+1:]
		if _, ok := b.domains[domain]; ok {
			return true
		}
	}
	return false
}

func (b *blocklist) count() int {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return len(b.domains)
}
