"""A stand-in for the Week 3 checkout, so the API can be tested off-container.

WHY THIS EXISTS, AND WHAT IT IS NOT
`app.main` imports `app.runner`, which imports the whole Week 3 tree at module
scope (that is how the service gets the real engine: the image clones Week 3 to
/week3 and puts it on the path). Nothing in main.py can therefore be imported
without *some* Week 3 on the path - so `make test`, which promises to need no
containers, could test nothing above `SaveScheduler`.

This package supplies the names those imports bind, and nothing else. It is NOT
a second debate engine and it is never asked to be one: every test that starts
a run patches `app.main.run_debate`, so the only code these modules have to
survive is the import statement itself. If Week 3 renames something the service
imports, this stub fails to satisfy it and the tests break - which is the point.
The engine's own behaviour is Week 3's to test.
"""
