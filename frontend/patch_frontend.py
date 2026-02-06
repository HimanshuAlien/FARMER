
import os

def patch_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    original_content = content
    
    # 1. Inject config.js in HTML files
    if filepath.endswith('.html'):
        if 'src="config.js"' not in content and 'src=\'config.js\'' not in content:
            if '</head>' in content:
                content = content.replace('</head>', '    <script src="config.js"></script>\n</head>')
            else:
                print(f"Warning: No </head> tag in {filepath}")

    # 2. Replace API calls
    # Common patterns
    replacements = [
        ("fetch('/api", "fetch(API_BASE_URL + '/api"),
        ('fetch("/api', 'fetch(API_BASE_URL + "/api'),
        ("fetch('http://localhost:5000", "fetch(API_BASE_URL + '"), # Fix this one carefully
        ('fetch("http://localhost:5000', 'fetch(API_BASE_URL + "'),
        # Handle string concatenation cases if any, but start with these
        ("url: 'http://localhost:5000", "url: API_BASE_URL + '"),
        ('url: "http://localhost:5000', 'url: API_BASE_URL + "'),
    ]

    for old, new in replacements:
        content = content.replace(old, new)

    # Special case: http://localhost:5000/api -> API_BASE_URL + '/api'
    # The previous replacements might result in API_BASE_URL + ''/api' which is fine-ish but let's be cleaner.
    # Actually "http://localhost:5000" might be used alone.
    
    if content != original_content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Patched {filepath}")
    else:
        print(f"No changes for {filepath}")

def main():
    # Walk through directory
    for root, dirs, files in os.walk('.'):
        if 'node_modules' in root:
            continue
            
        for file in files:
            if file.endswith('.html') or file.endswith('.js'):
                if file == 'config.js' or file == 'patch_frontend.py':
                    continue
                filepath = os.path.join(root, file)
                patch_file(filepath)

if __name__ == '__main__':
    main()
