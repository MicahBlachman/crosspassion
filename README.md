# Crosspassion

Crosspassion is a Reddit-style social network where every community is the intersection of two interests.

## Features

- Interest catalog and personal interest list
- Intersection communities (`Interest A x Interest B`)
- Create posts directly into an intersection
- Vote on posts and comments
- Threaded comments with replies
- Personalized crosspassion suggestions from your own interests
- Seed data inspired by the original crosspassion idea

## Run

```bash
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

## Dev mode

```bash
npm run dev
```

## Notes

- Data is stored locally in `data/db.json`.
- No external services or dependencies are required.

## Deploy without installing anything

You can host this online with Render using only your browser:

1. Create a new GitHub repo and upload this folder.
2. In Render, choose **New +** -> **Blueprint**.
3. Connect the GitHub repo and deploy.

`render.yaml` is already included, so Render will auto-configure the service.
