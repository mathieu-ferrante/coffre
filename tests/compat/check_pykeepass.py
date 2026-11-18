"""Vérifie avec pykeepass (implémentation KeePass indépendante) la compatibilité dans les deux sens."""
import subprocess, sys, pathlib
from pykeepass import PyKeePass, create_database

here = pathlib.Path(__file__).resolve().parent
work = pathlib.Path(sys.argv[1])
PW = "Phrase-De-Test-Compat-42"
app_file = work / "depuis-app.kdbx"
subprocess.run(["node", str(here / "make-vault.ts"), str(app_file), PW], check=True)

kp = PyKeePass(str(app_file), password=PW)
print("KDF:", kp.kdf_algorithm, "version", kp.version)
e = kp.find_entries(title="Banque", first=True)
assert e.username == "moi@exemple.fr" and e.password == "Nouveau!Mdp#2026" and e.notes == "note é漢", e
assert e.otp and "JBSWY3DPEHPK3PXP" in e.otp, e.otp
assert [h.password for h in e.history] == ["ancien-mdp"], [h.password for h in e.history]
assert kp.recyclebin_group is not None and any(x.title == "Ancien site" for x in kp.recyclebin_group.entries)
print("OK : pykeepass lit le coffre de l'app (mot de passe, notes, 2FA, historique, corbeille).")

# Sens inverse : coffre créé par pykeepass, ouvert par l'app
other = work / "depuis-pykeepass.kdbx"
db = create_database(str(other), password="autre-mot-de-passe-123")
g = db.add_group(db.root_group, "Perso")
db.add_entry(g, "Mail", "bob", "pw-bob", url="https://mail.fr", notes="hello")
db.add_entry(db.root_group, "Wifi", "", "wifi-secret")
db.save()
out = subprocess.run(["node", str(here / "read-vault.ts"), str(other), "autre-mot-de-passe-123"], check=True, capture_output=True, text=True).stdout
print(out)
assert '"title":"Mail"' in out and '"pw":"pw-bob"' in out and '"group":"Perso"' in out and '"pw":"wifi-secret"' in out
print("OK : l'app lit un coffre créé par pykeepass.")
