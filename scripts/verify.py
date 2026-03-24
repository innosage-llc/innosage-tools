from playwright.sync_api import sync_playwright

def verify():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto('http://localhost:3000/image-joiner')
        page.wait_for_selector('text=Image Joiner')
        page.screenshot(path='verification_image_joiner.png')
        browser.close()

if __name__ == '__main__':
    verify()
