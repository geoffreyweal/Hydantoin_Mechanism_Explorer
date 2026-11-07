# Hydantoin Mechanism Explorer

An interactive map of every mechanism considered for

phenylglyoxal hydrate + *N*-benzyl-*N*′-methyl(thio)urea → 5-phenyl(thio)hydantoins (H⁺ cat., CHCl₃)

The reaction gives two isomers: **P1a** (1-R-3-Me) and **P1b** (1-Me-3-R), with R = benzyl. Each of the 54
mechanism families (M1–M54) is drawn once ending at P1a (A) and once ending at P1b (B), for both the urea and
the thiourea. Species and step IDs (I5a, S3b …) are the same as in the mechflow projects used for the DFT
calculations.

Open `index.html` in a browser. No server or installation is needed, and the page also works straight from
the folder. The online version is at <https://geoffreyweal.github.io/Hydantoin_Mechanism_Explorer/>.

## What you can do

- **Mechanisms.** Pick a family and its A or B version. Each step with a transition state has its own colour,
  used for the arrow between the structures and for the curly arrows on the structure before it. Above each
  coloured arrow is a 3D picture of a TS guess. Proton transfers are grey steps through the acid catalyst (HA
  drawn as A–H, A⁻ as A⁻), each with its own TS.
- **Click a structure** to turn it in 3D (3Dmol.js). You can label the key atoms (C5, C4, O5 …), change the
  style, or download the xyz file.
- **Click a step arrow** to open the step in its own window:
  - the diagram: intermediate n with its curly arrows, the TS guess above the arrow, and intermediate n+1;
  - a 2D sketch of the TS, with the bonds that form or break dashed;
  - **3D: TS guess and path**: the 9 images of an IDPP interpolation (ASE NEB module) between the two sides of
    the step, with play and slider controls. The bonds that change are dashed.
- **Network.** Every mechanism in one network, ending at both products. Drag to move, scroll to zoom, and click
  a box or an arrow. Grey arrows are proton transfers through the acid catalyst (HA / A⁻). The **Show** menu
  filters the network by the votes (see below).
- **Species / Steps.** Searchable lists, with the votes. The search box also finds mechanisms (`M17`), species
  (`I52`) and steps (`S35a`). `is:possible`, `is:notpossible`, `is:disputed`, `is:unmarked`, `is:removed` and
  `is:added` filter the lists by the votes and edits.
- **Annotations.** Every vote, removal and addition, with who made it and when, and a button to download them
  all as `annotations.json`.
- **Links.** The address can open a view directly, for example `index.html#ch=S&m=M3A&step=S7b`,
  `#ch=O&mol=I7a`, or `#tab=net&filter=hide` (the network without what is marked not possible).

## Votes and edits (collaborators)

Everyone can see the votes and edits. Collaborators on the GitHub repository (people with push access to
`geoffreyweal/Hydantoin_Mechanism_Explorer`) can also add their own.

### Signing in

GitHub's own sign-in needs a server, which this static site does not have, so the page asks for a personal
access token instead. Press **Sign in with GitHub** (top right) and paste a token:

- **The repository owner** can use a fine-grained token: <https://github.com/settings/personal-access-tokens/new>,
  *Resource owner*: yourself; *Repository access*: only select repositories → `Hydantoin_Mechanism_Explorer`;
  *Repository permissions* → *Contents*: **Read and write**.
- **Collaborators** should use a classic token with the **`public_repo`** scope:
  <https://github.com/settings/tokens/new?scopes=public_repo&description=Hydantoin%20Mechanism%20Explorer>.
  A fine-grained token may not reach a repository that another user owns.
- Give the token an expiry date. You can revoke it on GitHub at any time.

The page checks the token with GitHub (who you are, and whether you have push access). The token stays in your
browser, for this tab only, unless you tick **remember on this computer** (not offered when the page is opened
from a file). It is sent only to `api.github.com`. **Sign out** forgets it. If you sign in without push access you
can still see everything, but not vote.

### Voting

Each step, mechanism and intermediate can be marked **✓ possible** or **✗ not possible**, separately for the
urea and the thiourea:

- a step: in its window (click its arrow);
- a mechanism: in the bar above its drawing;
- an intermediate: in its 3D window (click its structure).

Add a short note if you like (why, or what would decide it). Tick **urea and thiourea** to vote for both at once.
**clear** takes your vote back. Each collaborator has one vote per item, and the item's status is the majority:
*possible*, *not possible*, *disputed* (a tie) or *unmarked*. The lists show the votes as badges (✓ 2 ✗ 1), and
⚠ marks a mechanism that uses a step marked not possible or removed.

Changes are saved about 2 seconds after the last click, as one commit to the `annotations` branch (the header
shows *unsaved changes*, *saving…*, *saved* or the error). If someone else saved in the meantime, the page reads
their version, adds your changes to it and saves again: everyone only ever changes their own entries.

### The network filter

On the Network tab, **Show** offers:

- **everything**: every step, less what has been removed (see below) and whatever a removal cuts off from every
  route to a product;
- **hide what is not possible**: leaves out the steps marked not possible (unmarked counts as possible);
- **only what is marked possible**: keeps only the steps marked possible.

Both filters also leave out species and mechanisms marked not possible, and then everything that no longer lies
on a route from the reactants (R1 + R2) to a product. An arrow is kept only while at least one mechanism that
uses it is still allowed (a step added by a collaborator needs no mechanism). The filtered network is laid out
again in your browser with Graphviz (Viz.js, included in `assets/`).

### Removing and adding

- **remove from network** (next to the votes of a step or a mechanism) takes it out of the network for everyone;
  **restore to network** puts it back. **show removed (greyed)** on the Network tab shows removed items again,
  greyed.
- **+ step** (Network tab) adds a step between two states: existing species or states (`I5a`, `I2 + I132a`), or a
  new species given a name and, optionally, a SMILES. Give the step a name and a description, and say whether it
  is for the urea, the thiourea or both. Added species get IDs UI1, UI2 …, added steps US1, US2 …; they are drawn
  dashed in teal in the network.
- **+ mechanism** opens the builder: start at R1 + R2 and pick the next step from those that leave the current
  state (built-in or added, either way round), or add a new step on the spot, until you reach a product. Then
  name it. Added mechanisms get IDs U1, U2 …, are listed under the mechanisms as *Added by collaborators*, and
  their page shows the drawings of their steps in order (an added step is shown as a text card).
- You can delete what you added yourself (the **delete** button in its window), once nothing else uses it.

### Where the votes are kept

Everything is in one file, `annotations.json`, on the branch `annotations` of this repository (separate from
`main`, so that saving does not rebuild the site). Visitors read it from `raw.githubusercontent.com`, which can
lag a few minutes behind; signed-in collaborators read it through the GitHub API. The first save makes the branch
and the file. Without a network, or when the file cannot be read, the site works as before and says
*annotations unavailable*. The commit history of the branch is the full record of who changed what.

```json
{
 "format": "hydantoin-mechanism-annotations", "version": 1,
 "votes":      {"O|S7b": {"alice": {"v": "no", "note": "too slow at rt", "at": "2026-11-07T09:01:00.000Z"}}},
 "removed":    {"O|M3B": {"by": "bob", "at": "…", "note": "same as M3A here"}},
 "species":    {"UI1": {"name": "enol of I5a", "smiles": "OC(=C)…", "note": "", "ch": ["O"], "by": "alice", "at": "…", "uid": "…"}},
 "steps":      {"US1": {"from": "I5a", "to": "UI1", "name": "keto-enol tautomerism", "desc": "…", "ch": ["O"], "by": "alice", "at": "…", "uid": "…"}},
 "mechanisms": {"U1": {"name": "enol route", "desc": "…", "ch": ["O"], "product": "P1a", "by": "alice", "at": "…", "uid": "…",
                       "hops": [{"from": "R1 + R2", "step": "S97", "dir": "fwd", "to": "I1"}, …],
                       "path": ["R1 + R2", "S97", "I1", …, "P1a"]}}
}
```

Keys are `<O|S>|<ID>` (urea or thiourea). `v` is `yes` (possible) or `no` (not possible). States are species IDs
joined by ` + ` as in mechflow (`I2 + I132a`, `2 P1a`); `dir` says whether a step is used forwards or backwards;
`path` is the mechanism written as a mechflow path. The page checks everything it reads and ignores entries it
does not understand.

### Security

- Text written by collaborators (notes, names, SMILES, logins) is only ever shown as text, never as HTML.
- The page only runs its own scripts and only talks to `api.github.com` and `raw.githubusercontent.com`
  (a Content-Security-Policy enforces both). No libraries are loaded from other sites at run time.
- When the page is shown inside another site's frame, signing in is switched off.
- A token is as powerful as its scope: use one that expires, and revoke it on GitHub if in doubt.

## The TS guesses

They are not DFT results. For each step, one end is the structure the SCAN starts from. The other end has the
same atoms, with the step's bonds formed or broken and relaxed with a force field (MMFF). ASE's NEB module joins
the two ends with an IDPP interpolation. The TS guess is the image whose scanned distance is closest to a
typical TS value.

The files are in `xyz/ts_guesses/Ch_O|Ch_S/` (`<step>_path.xyz` and `<step>_TS_guess.xyz`) and open with:

```bash
ase gui xyz/ts_guesses/Ch_S/S7b_path.xyz
```

The starting structures of all species are in `xyz/species/`.

## Rebuilding

The site is generated from the study folder by `mechanisms/source/make_website.py` (run by
`mechanisms/source/build_all.sh`):

```bash
python make_website.py <study folder> <website folder>                  # everything
python make_website.py <study folder> <website folder> --network-only   # data, network and front end; keeps the drawings
python make_website.py <study folder> <website folder> --web-only       # only the front end (web/ -> assets/)
```

A drawing that fails does not stop the build: it is reported at the end and the page shows a placeholder for it.
Once the DFT jobs have run, rebuilding adds a "3D: DFT" tab to every step with a finished OptTS or IRC. The votes
and edits are not part of the build: they stay on the `annotations` branch.
