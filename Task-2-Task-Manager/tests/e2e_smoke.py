"""
Browser smoke test for Docket (optional, needs Python + Playwright).

    pip install playwright && python -m playwright install chromium
    python tests/e2e_smoke.py            # serves the app on a free port
    python tests/e2e_smoke.py --shots    # also refreshes screenshots/

Walks through every user-facing feature in a real Chromium browser and
fails on the first broken step or on any JavaScript error in the console.
"""

import functools
import http.server
import os
import socketserver
import sys
import threading

from playwright.sync_api import expect, sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = "--shots" in sys.argv


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
    handler.log_message = lambda *a, **k: None
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}/index.html"


def titles(page):
    return page.locator(".task-title").all_inner_texts()


def main():
    httpd, url = serve()
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1280, "height": 860}, color_scheme="light")
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: m.type == "error" and errors.append(m.text))
        page.goto(url)

        # Read: sample tasks on first visit
        expect(page.locator(".task")).to_have_count(4)
        expect(page.locator("#stat-total")).to_have_text("4")
        step("first visit shows 4 sample tasks")

        if SHOTS:
            os.makedirs(os.path.join(ROOT, "screenshots"), exist_ok=True)
            page.screenshot(path=os.path.join(ROOT, "screenshots", "desktop-light.png"), full_page=True)

        # Create: validation
        page.click("#task-form button[type=submit]")
        expect(page.locator("#task-title-error")).to_have_text("Please enter a task title.")
        expect(page.locator("#task-title")).to_have_attribute("aria-invalid", "true")
        step("empty title is rejected")

        # Create
        page.fill("#task-title", "Submit Datheon Task 2")
        page.select_option("#task-category", "work")
        page.select_option("#task-priority", "high")
        page.click("summary")
        page.fill("#task-notes", "Push to GitHub after review")
        page.press("#task-title", "Enter")
        expect(page.locator(".task")).to_have_count(5)
        assert titles(page)[0] == "Submit Datheon Task 2"
        expect(page.locator("#stat-total")).to_have_text("5")
        expect(page.locator("#task-title")).to_have_value("")
        step("task created at the top")

        # Update: edit dialog
        first = page.locator(".task").first
        first.locator(".edit-btn").click()
        expect(page.locator("#edit-dialog")).to_be_visible()
        page.fill("#edit-title", "Submit Datheon Task 2 (final)")
        page.select_option("#edit-category", "study")
        page.click("#edit-form button[type=submit]")
        expect(page.locator("#edit-dialog")).not_to_be_visible()
        expect(first.locator(".task-title")).to_have_text("Submit Datheon Task 2 (final)")
        expect(first.locator(".tag-category")).to_have_text("Study")
        step("task edited in dialog")

        # Edit validation + Escape cancels
        first.locator(".edit-btn").click()
        page.fill("#edit-title", "  ")
        page.click("#edit-form button[type=submit]")
        expect(page.locator("#edit-title-error")).to_have_text("Please enter a task title.")
        page.keyboard.press("Escape")
        expect(page.locator("#edit-dialog")).not_to_be_visible()
        expect(first.locator(".task-title")).to_have_text("Submit Datheon Task 2 (final)")
        step("edit validation and Escape")

        # Complete
        first.locator(".check").click()
        expect(page.locator(".task.is-completed")).to_have_count(1)
        expect(page.locator("#stat-completed")).to_have_text("1")
        expect(page.locator("#progress-label")).to_have_text("20%")
        step("task marked completed, stats updated")

        # Status filters
        page.click("[data-status=active]")
        expect(page.locator(".task")).to_have_count(4)
        page.click("[data-status=completed]")
        expect(page.locator(".task")).to_have_count(1)
        page.click("[data-status=all]")
        expect(page.locator(".task")).to_have_count(5)
        step("status filters")

        # Category filter
        page.click("[data-category=work]")
        expect(page.locator(".task")).to_have_count(1)
        page.click("[data-category=all]")
        step("category filter")

        # Search + empty state
        page.fill("#search-input", "chapter")
        expect(page.locator(".task")).to_have_count(1)
        page.fill("#search-input", "zzzz")
        expect(page.locator("#empty-state")).to_be_visible()
        page.click("#empty-action")
        expect(page.locator(".task")).to_have_count(5)
        step("search and clear filters")

        # Sort
        page.select_option("#sort-select", "priority")
        expect(page.locator(".drag-handle")).to_have_count(0)
        page.select_option("#sort-select", "manual")
        expect(page.locator(".drag-handle")).to_have_count(5)
        step("sorting toggles drag handles")

        # Keyboard reorder
        before = titles(page)
        page.locator(".task").nth(1).locator(".drag-handle").focus()
        page.keyboard.press("ArrowUp")
        after = titles(page)
        assert after[0] == before[1] and after[1] == before[0], after
        step("keyboard reorder")

        # Pointer drag: move the first task below the third
        before = titles(page)
        handle = page.locator(".task").first.locator(".drag-handle").bounding_box()
        target = page.locator(".task").nth(2).bounding_box()
        page.mouse.move(handle["x"] + handle["width"] / 2, handle["y"] + handle["height"] / 2)
        page.mouse.down()
        page.mouse.move(handle["x"] + 10, target["y"] + target["height"] * 0.8, steps=12)
        page.mouse.up()
        after = titles(page)
        assert after[2] == before[0], (before, after)
        step("drag-and-drop reorder")

        # Delete + undo
        count = page.locator(".task").count()
        victim = titles(page)[1]
        page.locator(".task").nth(1).locator(".delete-btn").click()
        expect(page.locator(".task")).to_have_count(count - 1)
        expect(page.locator("#toast")).to_be_visible()
        page.click("#toast-action")
        expect(page.locator(".task")).to_have_count(count)
        assert titles(page)[1] == victim
        step("delete and undo")

        # Persistence after reload
        order = titles(page)
        page.reload()
        assert titles(page) == order
        expect(page.locator(".task.is-completed")).to_have_count(1)
        step("state persists after reload")

        # Clear completed with confirmation
        page.click("#clear-completed-btn")
        expect(page.locator("#confirm-dialog")).to_be_visible()
        page.click("#confirm-ok")
        expect(page.locator(".task.is-completed")).to_have_count(0)
        expect(page.locator(".task")).to_have_count(4)
        step("clear completed")

        # Theme toggle persists
        page.click("#theme-toggle")
        expect(page.locator("html")).to_have_attribute("data-theme", "dark")
        page.reload()
        expect(page.locator("html")).to_have_attribute("data-theme", "dark")
        step("theme toggle persists")

        if SHOTS:
            page.locator(".task").nth(1).locator(".check").click()
            page.wait_for_timeout(600)
            page.screenshot(path=os.path.join(ROOT, "screenshots", "desktop-dark.png"), full_page=True)
            page.locator(".task").first.locator(".edit-btn").click()
            page.wait_for_timeout(300)
            page.screenshot(path=os.path.join(ROOT, "screenshots", "edit-dialog.png"))
            page.keyboard.press("Escape")

        # Mobile layout
        mobile = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                                     is_mobile=True, has_touch=True, color_scheme="light")
        m = mobile.new_page()
        m.on("pageerror", lambda e: errors.append(str(e)))
        m.goto(url)
        expect(m.locator(".task")).to_have_count(4)
        overflow = m.evaluate("document.documentElement.scrollWidth > window.innerWidth")
        assert not overflow, "horizontal overflow on mobile"
        step("mobile layout has no horizontal overflow")
        if SHOTS:
            m.screenshot(path=os.path.join(ROOT, "screenshots", "mobile.png"), full_page=True)

        browser.close()
    httpd.shutdown()

    if errors:
        print("Console errors:", *errors, sep="\n  ")
        sys.exit(1)
    print("\nAll browser checks passed.")


def step(name):
    print(f"  ok  {name}")


if __name__ == "__main__":
    main()
