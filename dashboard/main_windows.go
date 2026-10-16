package main

import (
	"fmt"
	"log"
	"os"

	"golang.org/x/sys/windows/svc"
)

const serviceName = "AdblockDashboard"

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "install":
			if err := installService(); err != nil {
				fmt.Fprintf(os.Stderr, "Failed to install: %v\n", err)
				os.Exit(1)
			}
			fmt.Println("Dashboard service installed.")
			return
		case "uninstall":
			if err := uninstallService(); err != nil {
				fmt.Fprintf(os.Stderr, "Failed to uninstall: %v\n", err)
				os.Exit(1)
			}
			fmt.Println("Dashboard service uninstalled.")
			return
		case "start":
			if err := startService(); err != nil {
				fmt.Fprintf(os.Stderr, "Failed to start: %v\n", err)
				os.Exit(1)
			}
			fmt.Println("Dashboard started. Open http://localhost:9001")
			return
		case "stop":
			if err := stopService(); err != nil {
				fmt.Fprintf(os.Stderr, "Failed to stop: %v\n", err)
				os.Exit(1)
			}
			fmt.Println("Dashboard stopped.")
			return
		case "run":
			runDashboard()
			return
		}
	}

	isService, err := svc.IsWindowsService()
	if err != nil {
		log.Fatalf("Failed to determine if running as service: %v", err)
	}
	if isService {
		svc.Run(serviceName, &dashboardService{})
		return
	}

	fmt.Println("AdblockDashboard")
	fmt.Println("")
	fmt.Println("Usage:")
	fmt.Println("  AdblockDashboard.exe install    Install as Windows service")
	fmt.Println("  AdblockDashboard.exe uninstall  Remove service")
	fmt.Println("  AdblockDashboard.exe start      Start service")
	fmt.Println("  AdblockDashboard.exe stop       Stop service")
	fmt.Println("  AdblockDashboard.exe run        Run in console")
}
