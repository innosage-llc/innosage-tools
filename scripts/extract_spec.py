import json
import os
import re

def extract_spec(json_path, output_path):
    if not os.path.exists(json_path):
        print(f"Error: {json_path} not found.")
        return

    with open(json_path, 'r') as f:
        data = json.load(f)

    markdown_content = "# Feature Specification: Image Joiner\n\n"
    markdown_content += "> [!IMPORTANT]\n"
    markdown_content += "> This document is a **Visual Storyboard** automatically generated from E2E tests.\n"
    markdown_content += "> It captures the verified UI state at the end of each user action.\n\n"

    for test in data.get('tests', []):
        nodeid = test.get('nodeid', '')
        if 'test_image_joiner_ssot.py' not in nodeid:
            continue

        func_name = nodeid.split('::')[-1]
        title = func_name.replace('test_', '').replace('_', ' ').title()
        markdown_content += f"## {title}\n\n"
        markdown_content += "### User Journey Storyboard\n\n"

        stdout = test.get('setup', {}).get('stdout', '') + \
                 test.get('call', {}).get('stdout', '') + \
                 test.get('teardown', {}).get('stdout', '')

        # Find all steps and screenshots
        # Pattern: --- STEP: User navigates --- followed eventually by --- SCREENSHOT: path/to/step_1_user_navigates.png ---
        # We'll use a more structured approach to pair them
        lines = stdout.split('\n')
        current_step = None
        
        for line in lines:
            step_match = re.search(r"--- STEP: (.*?) ---", line)
            if step_match:
                current_step = step_match.group(1)
                markdown_content += f"#### Step: {current_step}\n"
                continue
            
            shot_match = re.search(r"--- SCREENSHOT: (.*?) ---", line)
            if shot_match and current_step:
                full_path = shot_match.group(1)
                # Path relative to docs/features/
                # docs/features/image_joiner_spec.md
                # test-results/screenshots/step_1_...png
                # Rel path: ../../test-results/screenshots/step_1_...png
                rel_path = os.path.join("../../", full_path)
                markdown_content += f"![{current_step}]({rel_path})\n\n"
                current_step = None

        markdown_content += "\n---\n"

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w') as f:
        f.write(markdown_content)
    
    print(f"Successfully generated visual storyboard at: {output_path}")

if __name__ == "__main__":
    report_file = "test-results/report.json"
    spec_file = "docs/features/image_joiner_spec.md"
    extract_spec(report_file, spec_file)
