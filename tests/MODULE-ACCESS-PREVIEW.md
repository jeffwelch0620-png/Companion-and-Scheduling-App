# Local module-access walkthrough

Build the current source before opening the walkthrough. From the source folder,
run `node review.mjs build`, then run `./tests/start-module-access-preview.ps1`
in PowerShell. The launcher uses a short workspace temporary folder for workerd.
Leave that terminal running; enter `stop` to stop all preview endpoints.

This is an isolated fictional fixture with one disposable database shared by the
accounts. A new launch creates new practice records; restarting does not preserve
the actions from a previous walkthrough. External services and supplier sending
are disabled. These endpoints do not provision real accounts.

| Role | Open |
| --- | --- |
| Owner | http://127.0.0.1:6901/module-access?role=owner&location=berts |
| General manager | http://127.0.0.1:6902/module-access?role=general-manager&location=berts |
| FOH manager | http://127.0.0.1:6903/module-access?role=department-manager&location=berts |
| BOH manager | http://127.0.0.1:6904/module-access?role=department-manager&location=berts |
| Cook | http://127.0.0.1:6905/module-access?role=frontline&location=berts |
| Dishwasher | http://127.0.0.1:6906/module-access?role=frontline&location=berts |
| Independent kitchen verifier | http://127.0.0.1:6907/module-access?role=department-manager&location=berts |

Owner membership includes Bert's, Rudd's, Papa Leone's, and the commissary. The
commissary is production; the three restaurants use FOH and BOH. Only Bert's has
the practice operating records. Missing summaries at other locations remain
missing evidence rather than a claim that operations are ready.

The GM has Bert's membership and explicit restaurant operations authority, without
owner administration, People management, purchasing, or scheduling authority.
FOH and BOH managers have their own department scopes. Cook and Dishwasher have
their own work. The verifier is a distinct authenticated BOH manager with task and
guide review permissions.

Use the BOH manager to assign ordinary work to the Dishwasher, open that work from
the Dishwasher home and report it ready, then verify it with the independent
kitchen verifier. Reopen the saved task to inspect the original identity,
restaurant, revision, and action history. Also check linked Manager Log records,
submitted summaries, Inbox, approved Dishwasher guidance, and shared Cook feedback.

Access checks must cover saved results and rejected actions, including another
person, department, restaurant, and stale revision. A denied action must leave
records, history, and retry receipts unchanged. Screen visibility alone does not
prove a permitted save or a denial without changes. Use the service test receipt
alongside the browser walkthrough for those mutation checks.

The fixture writes its current canonical record identities to
`.sites-runtime/module-access-preview-records.json`. These identities are newly
generated at each launch and are not live restaurant records.

The corrected-build desktop and phone task-history checks passed. The phone check
used a 390-by-844 viewport with document width 390. Further module permission
matrices and shared connections remain separate; this fixture does not establish
that every module workflow is fully accepted. See the packaged handoff receipt.
