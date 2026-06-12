# XYZ Studio

XYZStudio is a typescript project that is an interactive video generation platform.

User will give it an idea as an input such as "A 5 min youtube video about 'how to architect a stock exchange', be informative, engaging, and funny, with hooks and conclusing remarks to like and subscribe". description can also be really detailed and long

It will first generate a video transcript including:
1. Timestamp
2. Narrative text
3. description for the video scenen displayed on screen, any animation etc used helpful to generate the video. 
4. [Optional] Example video scene sketch as image

Overall video style will be animated cartoon like, that can also includes anomated diagrams, charts, graphs, etc. Or whiteboard explainer sketch style.  (User can choose style, but the style should stay consistent and elements such as characters used should be consistent throughout a video)

User can perform edit or provide feedback to the background LLM to revise the transcript.

After the video transcript is finalized, user can ask it to generate the video clips, for each scene, voice, as well as video title, descriptions, any hashtags that can be used to post on Youtube, tiktok, etc.

The tool should be a react app and backend long running server, with vue, in typescript. 

The tool will store all the the sessions and videos generated in local disk, keep records in a SQL database. (Let's use SQLite database for now. later will migrate to a postgres database in Supabase).

User can kick off the session and allow the server to work async in the background and later check. 

Testing should include unit test, integration test and end to end tests according to different granularity. 

You will need to figure out the best combination of models and providers to use for generating text, video, voice, etc