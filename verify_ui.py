from playwright.sync_api import sync_playwright
import time
import os

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Navigate to the app
        print("Navigating to app...")
        try:
            page.goto("http://localhost:8090", timeout=10000)
        except Exception as e:
            print(f"Failed to load page: {e}")
            return

        # Ensure verification directory exists
        if not os.path.exists("verification"):
            os.makedirs("verification")

        print("Page loaded.")

        # Take initial screenshot
        page.screenshot(path="verification/initial_load.png")

        # --- Add Proxy ---
        print("Adding Proxy...")
        # Use a more robust selector if possible, or wait for visibility
        try:
            # Check if button is visible
            add_proxy_btn = page.locator("button.add-btn", has_text="+ Add Proxy")
            add_proxy_btn.wait_for(state="visible", timeout=5000)
            add_proxy_btn.click()
            print("Proxy added.")
        except Exception as e:
            print(f"Failed to click Add Proxy: {e}")
            page.screenshot(path="verification/error_add_proxy.png")
            return

        # Fill in Proxy details
        try:
            proxy_item = page.locator("#proxyList .config-item").first
            proxy_item.wait_for(state="visible")
            proxy_item.locator(".proxy-listen").fill(":8080")
            proxy_item.locator(".proxy-upstream").fill("localhost:9000")
            proxy_item.locator(".proxy-ntlm").check()
            print("Proxy details filled.")
        except Exception as e:
            print(f"Failed to fill proxy details: {e}")
            page.screenshot(path="verification/error_fill_proxy.png")
            return

        # --- Add Layer 4 ---
        print("Adding Layer 4...")
        try:
            add_l4_btn = page.locator("button.add-btn", has_text="+ Add Layer 4")
            add_l4_btn.click()
            print("Layer 4 added.")
        except Exception as e:
            print(f"Failed to click Add Layer 4: {e}")
            return

        # Fill in Layer 4 details
        try:
            l4_item = page.locator("#layer4List .config-item").first
            l4_item.wait_for(state="visible")
            l4_item.locator(".l4-listen").fill(":8443")
            l4_item.locator(".l4-upstream").fill("localhost:9443")
            print("Layer 4 details filled.")
        except Exception as e:
            print(f"Failed to fill Layer 4 details: {e}")
            return

        # Save Configuration
        print("Saving configuration...")
        try:
            page.click("text=Save Configuration")
            # Wait for success message
            page.wait_for_selector("#structuredConfigStatus", timeout=5000)
            status_text = page.inner_text("#structuredConfigStatus")
            print(f"Status: {status_text}")
        except Exception as e:
            print(f"Failed to save configuration: {e}")
            page.screenshot(path="verification/error_save.png")

        # Take a screenshot of the configured UI
        page.screenshot(path="verification/ui_configured.png")
        print("UI screenshot saved.")

        # Switch to Raw Caddyfile tab to verify generation
        print("Switching to Raw Caddyfile tab...")
        try:
            page.click("text=Raw Caddyfile")
            page.wait_for_timeout(1000)

            # Take a screenshot of the generated Caddyfile
            page.screenshot(path="verification/caddyfile_generated.png")
            print("Caddyfile screenshot saved.")
        except Exception as e:
             print(f"Failed to switch tab: {e}")

        browser.close()

if __name__ == "__main__":
    run()
