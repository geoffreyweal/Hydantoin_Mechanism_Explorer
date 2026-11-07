/* Where the collaborators' votes and edits are kept: annotations.json on its own branch of the site's GitHub
   repository, so that saving does not rebuild the site. When the site is served from
   https://<owner>.github.io/<repo>/ the owner and repo are read from the address instead. */
window.HME_CONFIG = {
  owner: "geoffreyweal",
  repo: "Hydantoin_Mechanism_Explorer",
  branch: "annotations",
  file: "annotations.json"
};
