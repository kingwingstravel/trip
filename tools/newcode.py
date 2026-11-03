"""Print a new free group code and a PIN: python3 newcode.py REPO_DIR"""
import sys,os,secrets
repo=sys.argv[1] if len(sys.argv)>1 else '..'
a='abcdefghjkmnpqrstuvwxyz23456789'
while True:
    c=''.join(secrets.choice(a) for _ in range(8))
    if not os.path.exists(os.path.join(repo,'g',c)): break
print(c,'%06d'%secrets.randbelow(10**6))
