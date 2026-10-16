package main

import (
	"fmt"
	"log"
	"os"

	"golang.org/x/sys/windows/svc"
)

const serviceName = "AdblockDNS"

func main() {
	// If run with "install", "uninstall", "start", "stop" arguments, handle those
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "install":
			if err := installService(); err != nil {
				fmt.Fprintf(os.Stderr, "Failed to install service: %v\n", err)
				os.Exit(1)
			}
			fmt.Println("Service installed successfully.")
			fmt.Println("Run: AdblockDNS.exe start")
			return
		case "uninstall":
			if err := uninstallService(); err != nil {
				fmt.Fprintf(os.Stderr, "Failed to uninstall service: %v\n", err)
				os.Exit(1)
			}
			fmt.Println("Service uninstalled.")
			return
		case "start":
			if err := startService(); err != nil {
				fmt.Fprintf(os.Stderr, "Failed to start service: %v\n", err)
				os.Exit(1)
			}
			fmt.Println("Service started.")
			return
		case "stop":
			if err := stopService(); err != nil {
				fmt.Fprintf(os.Stderr, "Failed to stop service: %v\n", err)
				os.Exit(1)
			}
			fmt.Println("Service stopped.")
			return
		case "run":
			// Run directly in console (for testing)
			runDNS()
			return
		}
	}

	// Check if running as a Windows service
	isService, err := svc.IsWindowsService()
	if err != nil {
		log.Fatalf("Failed to determine if running as service: %v", err)
	}

	if isService {
		if err := svc.Run(serviceName, &adblockService{}); err != nil {
			log.Fatalf("Service failed: %v", err)
		}
		return
	}

	// No args and not a service — show usage
	fmt.Println("AdblockDNS - Network-level ad blocker")
	fmt.Println("")
	fmt.Println("Usage:")
	fmt.Println("  AdblockDNS.exe install    Install as Windows service (run as Administrator)")
	fmt.Println("  AdblockDNS.exe uninstall  Remove the Windows service")
	fmt.Println("  AdblockDNS.exe start      Start the service")
	fmt.Println("  AdblockDNS.exe stop       Stop the service")
	fmt.Println("  AdblockDNS.exe run        Run in console (for testing)")
}
