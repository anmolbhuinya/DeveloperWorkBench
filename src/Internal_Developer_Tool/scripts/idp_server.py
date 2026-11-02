"""Developer WorkBench launcher (startidp / stopidp). The server code lives in idp_core.py and is imported here, so Python
caches it as bytecode: running a 1.6 MB script directly would recompile it on every start (about 2.5 s)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import idp_core

if __name__ == "__main__":
    idp_core.main()
