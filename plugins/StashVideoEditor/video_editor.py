import json
import sys

def main():
    json_input = json.loads(sys.stdin.read())
    print(json.dumps({"output": "stub", "args": json_input.get("args", {})}))

if __name__ == "__main__":
    main()
