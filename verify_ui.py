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

        # --- Login ---
        print("Logging in...")
        try:
            page.fill("input[name='username']", "admin")
            page.fill("input[name='password']", "admin")
            page.click("button:has-text('Login')")
            page.wait_for_selector("text=Reverse Proxy")
            print("Logged in.")
        except Exception as e:
            print(f"Failed to log in: {e}")
            page.screenshot(path="verification/error_login.png")
            return

        # --- Add Domain ---
        print("Adding Domain...")
        try:
            page.click("text=Reverse Proxy")
            page.wait_for_timeout(500) # Give the tab time to switch
            page.click("button:has-text('+ Add Domain')")
            page.wait_for_selector("#domainModal", state="visible")
            page.fill("#d_fd", "example.com")
            page.fill("#d_fp", "443")
            page.check("#d_en")
            page.click("#domainModal .btn-primary:has-text('Save')")
            page.wait_for_selector("#domainModal", state="hidden")
            print("Domain added.")
        except Exception as e:
            print(f"Failed to add Domain: {e}")
            page.screenshot(path="verification/error_add_domain.png")
            return

        # --- Add Handler ---
        print("Adding Handler...")
        try:
            page.click("a[href='#rp-handlers']")
            page.click("button:has-text('+ Add Handler')")
            page.wait_for_selector("#handlerModal", state="visible")
            page.check("#h_en")
            # Select the domain we just added (example.com)
            page.select_option("#h_rev", label="example.com")
            page.fill("#h_td", "localhost")
            page.fill("#h_tp", "9000")
            page.click("#handlerModal .btn-primary:has-text('Save')")
            page.wait_for_selector("#handlerModal", state="hidden")
            print("Handler added.")
        except Exception as e:
            print(f"Failed to add Handler: {e}")
            page.screenshot(path="verification/error_add_handler.png")
            return

        # --- Add Layer 4 ---
        print("Adding Layer 4...")
        try:
            page.click("text=Layer 4")
            page.click("button:has-text('+ Add Route')")
            page.wait_for_selector("#layer4Modal", state="visible")
            page.check("#l4_en")
            page.fill("#l4_fp", "8443")
            page.fill("#l4_td", "localhost")
            page.fill("#l4_tp", "9443")
            page.click("#layer4Modal .btn-primary:has-text('Save')")
            page.wait_for_selector("#layer4Modal", state="hidden")
            print("Layer 4 added.")
        except Exception as e:
            print(f"Failed to click Add Layer 4: {e}")
            page.screenshot(path="verification/error_add_l4.png")
            return

        # Save Configuration
        print("Saving configuration...")
        try:
            page.click("text=Apply Configuration")
            # Wait for success message
            page.wait_for_selector("#globalStatus", timeout=5000)
            status_text = page.inner_text("#globalStatus")
            print(f"Status: {status_text}")
        except Exception as e:
            print(f"Failed to save configuration: {e}")
            page.screenshot(path="verification/error_save.png")

        # Take a screenshot of the configured UI
        page.screenshot(path="verification/ui_configured.png")
        print("UI screenshot saved.")

        # Switch to Control & Raw tab to verify generation
        print("Switching to Control & Raw tab...")
        try:
            page.click("text=Control & Raw")
            page.wait_for_timeout(1000)

            # Take a screenshot of the generated Caddyfile
            page.screenshot(path="verification/caddyfile_generated.png")
            print("Caddyfile screenshot saved.")
        except Exception as e:
             print(f"Failed to switch tab: {e}")

        browser.close()

if __name__ == "__main__":
    run()
