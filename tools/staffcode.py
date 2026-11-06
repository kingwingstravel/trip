"""Print a 6-digit code for the guide/agent mode, different from the group PIN: python3 staffcode.py PIN
Goes into the guide sheet B26 and into GROUP.json as staffCode (never shown to tourists)."""
import sys,secrets
pin=sys.argv[1] if len(sys.argv)>1 else ''
while True:
    c='%06d'%secrets.randbelow(10**6)
    if c!=pin and len(set(c))>2: break
print(c)
