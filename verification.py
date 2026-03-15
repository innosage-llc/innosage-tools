from playwright.sync_api import Page, expect, sync_playwright

def test_recorder_page(page: Page):
    page.goto("http://localhost:3000/tools/recorder")

    # Wait for the page to load
    expect(page.get_by_text("Continuous Recorder")).to_be_visible()

    # Click Audio Only button
    audio_btn = page.get_by_role("button", name="Audio Only")
    audio_btn.click()

    # Take screenshot of the setup state
    page.screenshot(path="verification_setup.png")

    # Start Recording
    start_btn = page.get_by_role("button", name="Start Recording")

    # We cannot easily mock the user media and file picker right away,
    # but let's take a screenshot before clicking.
    # We're just verifying the UI loaded and the buttons work.
    page.screenshot(path="verification.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        # Launch browser with fake media devices to prevent permissions issues
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--use-fake-ui-for-media-stream",
                "--use-fake-device-for-media-stream",
            ]
        )
        # Give permission to camera and microphone
        context = browser.new_context(permissions=['camera', 'microphone'])
        page = context.new_page()
        try:
            test_recorder_page(page)
        finally:
            browser.close()
