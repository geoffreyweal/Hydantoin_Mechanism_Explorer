/* Where the collaborators' statuses and edits are kept, and how they sign in.

   owner, repo, branch, file: annotations.json on its own branch of the site's GitHub repository, so that saving
   does not rebuild the site. When the site is served from https://<owner>.github.io/<repo>/ the owner and repo are
   read from the address instead.

   clientId, tokenUrl: sign-in with GitHub. clientId is the Client ID of the site's GitHub App, and tokenUrl is the
   /token address of the sign-in Worker (signin_worker/, see README_signin.md). While either is empty the site
   offers no sign-in and is read-only. After setting them, rebuild with make_website.py --web-only: that also
   writes the Worker's address into the page's Content-Security-Policy. */
window.HME_CONFIG = {
  owner: "geoffreyweal",
  repo: "Hydantoin_Mechanism_Explorer",
  branch: "annotations",
  file: "annotations.json",
  clientId: "Iv23li7D6gvUidxSzFb9",
  tokenUrl: "https://hme-signin.geoffrey-weal.workers.dev/token"
};
