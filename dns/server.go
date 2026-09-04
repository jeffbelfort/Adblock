package main

import (
	"log"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/miekg/dns"
)

type cacheEntry struct {
	msg     *dns.Msg
	expires time.Time
}

type server struct {
	cfg       *config
	bl        *blocklist
	udpServer *dns.Server
	tcpServer *dns.Server
	cache     map[string]*cacheEntry
	cacheMu   sync.RWMutex
}

func newServer(cfg *config, bl *blocklist) *server {
	return &server{
		cfg:   cfg,
		bl:    bl,
		cache: make(map[string]*cacheEntry),
	}
}

func (s *server) start() error {
	mux := dns.NewServeMux()
	mux.HandleFunc(".", s.handleQuery)

	s.udpServer = &dns.Server{Addr: s.cfg.ListenAddr, Net: "udp", Handler: mux}
	s.tcpServer = &dns.Server{Addr: s.cfg.ListenAddr, Net: "tcp", Handler: mux}

	errCh := make(chan error, 2)
	go func() {
		if err := s.udpServer.ListenAndServe(); err != nil {
			errCh <- err
		}
	}()
	go func() {
		if err := s.tcpServer.ListenAndServe(); err != nil {
			errCh <- err
		}
	}()

	time.Sleep(150 * time.Millisecond)
	select {
	case err := <-errCh:
		return err
	default:
		return nil
	}
}

func (s *server) stop() {
	if s.udpServer != nil {
		s.udpServer.Shutdown()
	}
	if s.tcpServer != nil {
		s.tcpServer.Shutdown()
	}
}

func (s *server) handleQuery(w dns.ResponseWriter, r *dns.Msg) {
	if len(r.Question) == 0 {
		return
	}

	q := r.Question[0]
	domain := q.Name

	if s.bl.isBlocked(domain) {
		log.Printf("[BLOCKED] %s", strings.TrimSuffix(domain, "."))
		s.writeBlocked(w, r)
		return
	}

	cacheKey := domain + "_" + dns.TypeToString[q.Qtype]
	if cached := s.getCache(cacheKey); cached != nil {
		resp := cached.Copy()
		resp.Id = r.Id
		w.WriteMsg(resp)
		return
	}

	resp, err := s.forward(r)
	if err != nil {
		log.Printf("[adblock-dns] Forward error for %s: %v", domain, err)
		s.writeServFail(w, r)
		return
	}

	if s.cnameIsBlocked(resp) {
		log.Printf("[BLOCKED via CNAME] %s", strings.TrimSuffix(domain, "."))
		s.writeBlocked(w, r)
		return
	}

	s.setCache(cacheKey, resp)
	w.WriteMsg(resp)
}

func (s *server) writeBlocked(w dns.ResponseWriter, r *dns.Msg) {
	m := new(dns.Msg)
	m.SetReply(r)
	m.Authoritative = true

	if r.Question[0].Qtype == dns.TypeA {
		m.Answer = append(m.Answer, &dns.A{
			Hdr: dns.RR_Header{
				Name:   r.Question[0].Name,
				Rrtype: dns.TypeA,
				Class:  dns.ClassINET,
				Ttl:    60,
			},
			A: net.IPv4(0, 0, 0, 0),
		})
	} else {
		m.SetRcode(r, dns.RcodeNameError)
	}
	w.WriteMsg(m)
}

func (s *server) writeServFail(w dns.ResponseWriter, r *dns.Msg) {
	m := new(dns.Msg)
	m.SetRcode(r, dns.RcodeServerFailure)
	w.WriteMsg(m)
}

func (s *server) forward(r *dns.Msg) (*dns.Msg, error) {
	c := &dns.Client{Net: "udp", Timeout: 5 * time.Second}
	resp, _, err := c.Exchange(r, s.cfg.UpstreamDNS)
	if err != nil {
		c.Net = "tcp"
		resp, _, err = c.Exchange(r, s.cfg.UpstreamDNS)
	}
	return resp, err
}

func (s *server) cnameIsBlocked(resp *dns.Msg) bool {
	for _, rr := range resp.Answer {
		if cname, ok := rr.(*dns.CNAME); ok {
			target := strings.TrimSuffix(cname.Target, ".")
			if s.bl.isBlocked(target) {
				return true
			}
		}
	}
	return false
}

func (s *server) getCache(key string) *dns.Msg {
	s.cacheMu.RLock()
	defer s.cacheMu.RUnlock()
	entry, ok := s.cache[key]
	if !ok || time.Now().After(entry.expires) {
		return nil
	}
	return entry.msg
}

func (s *server) setCache(key string, msg *dns.Msg) {
	s.cacheMu.Lock()
	defer s.cacheMu.Unlock()
	s.cache[key] = &cacheEntry{
		msg:     msg,
		expires: time.Now().Add(time.Duration(s.cfg.CacheTTL) * time.Second),
	}
}
