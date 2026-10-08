# AM and PM Dishwasher checkout walkthrough

The current fixture adds two independently authenticated fictional PM Dishwashers
on ports 6908 and 6909; the existing Dishwasher on 6906 is the AM person. Manager
and GM accounts stay on 6904 and 6902. The independent verifier stays on 6907.
These are separate identities in one disposable local database, not real accounts.

Build the corrected source, then run `tests/start-module-access-preview.ps1` in
PowerShell from the source folder. External services remain disabled. A fresh
launch creates new practice records and does not preserve prior walkthrough saves.

1. As BOH manager or GM, open the existing shift duties view and select **Set up
   AM / PM checkouts**. Choose one AM and two distinct PM Dishwashers. Set the
   restaurant business date, the observable checkout criteria, and due time. This
   creates three separate ordinary task records.
2. As AM Dishwasher, open the AM checkout and save an unfinished-work handoff to
   one incoming PM Dishwasher. Include the unfinished work and specific next action.
   The AM checkout remains separate and does not become manager validated merely
   because work was passed forward.
3. As the named incoming PM Dishwasher, open the linked incoming work and
   acknowledge it. Record completion evidence and report it ready. A BOH manager
   or GM validates that incoming work. The PM checkout remains blocked until its
   linked unfinished work is validated.
4. Have each PM Dishwasher report their own checkout ready and have a different
   authorized manager or GM validate each separately. One PM completion cannot
   close the other PM record. Complete and validate the AM checkout separately.
5. Reopen original records and history across the accounts. Confirm the same
   restaurant, record identities, actor names, revisions, and retry receipts.
6. Managers see the station incomplete when an expected checkout or linked
   incoming record is missing, unacknowledged, or not validated. Frontline staff
   see only their own checkout and incoming work; the app does not infer the whole
   station's completion from an intentionally filtered frontline workspace.

Each save uses the existing command/revision path. Wrong-person, department,
restaurant, stale-source, self-verification, generic issue or manager handoff
requests must remain denied without changing saved data. The new workflow grants
no generic issue or manager-handoff authority to a Dishwasher.

This extension needs its own test receipt and browser acceptance; the previous
module-access source package stays unchanged as the prior accepted package.
