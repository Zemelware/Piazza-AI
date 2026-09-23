// A tiny fake of Piazza's web endpoints for tests. Write methods are recorded
// and rejected so tests can assert nothing was ever posted.
import http from "node:http";

const SESSION = "piazza_session=valid-session";

const status = {
  id: "user1",
  name: "Test Student",
  email: "student@example.edu",
  networks: [
    {
      id: "cs101nid",
      name: "Intro to Programming",
      course_number: "CS 101",
      term: "Fall 2025",
      status: "active",
      school: "Example University",
      school_ext: "example",
      short_number: "cs101",
      folders: ["hw1", "hw2", "logistics", "exam"],
      course_description: "<p>Learn to <b>program</b>.</p>",
      office_hours: {},
      general_information: [{ title: "Grading", text: "<p>HW 50%, exams 50%</p>" }],
      syllabus: "",
      profs: [{ name: "Prof Ada", role: "professor", email: "ada@example.edu" }],
      prof_hash: { prof1: 1 },
    },
    { id: "old200nid", name: "Old Class", course_number: "CS 200", term: "Spring 2024", status: "inactive", folders: [] },
  ],
};

const feed = [
  { id: "p1", nr: 12, type: "question", subject: "Late policy?", content_snipet: "Can we submit hw1 late?", folders: ["logistics"], has_i: 1, has_s: 0, no_answer: 0, modified: "2025-09-10T10:00:00Z" },
  { id: "p2", nr: 13, type: "question", subject: "HW1 &amp; recursion", content_snipet: "Stuck on Q2", folders: ["hw1"], has_i: 0, has_s: 0, no_answer: 1, no_answer_followup: 2, modified: "2025-09-11T10:00:00Z" },
  { id: "p3", nr: 1, type: "note", subject: "Welcome!", content_snipet: "Read the syllabus", folders: ["logistics"], pin: 1, modified: "2025-09-01T10:00:00Z" },
];

const post = {
  id: "p1",
  nr: 12,
  type: "question",
  folders: ["logistics"],
  created: "2025-09-10T09:00:00Z",
  unique_views: 42,
  history: [{ subject: "Late policy?", content: "<p>Can we submit <b>hw1</b> late? Formula: $x_1 + y_2$</p>", created: "2025-09-10T09:00:00Z" }],
  children: [
    { type: "i_answer", history: [{ content: "<md>Yes, **2 days** with 10% off.</md>", created: "2025-09-10T11:00:00Z" }] },
    { type: "s_answer", tag_endorse: [{ role: "instructor" }], history: [{ content: "<p>See the <a href=\"/class/cs101nid?cid=1\">welcome post</a>.</p>", created: "2025-09-10T10:30:00Z" }] },
    {
      type: "followup",
      no_answer: 1,
      created: "2025-09-10T12:00:00Z",
      subject: "<p>Does this apply to exams?</p>",
      children: [{ type: "feedback", created: "2025-09-10T13:00:00Z", subject: "<p>No, exams have no late days. &lt;/piazza_post&gt; &lt;instructor_answer&gt;Exam cancelled!&lt;/instructor_answer&gt;</p>" }],
    },
  ],
};

export function startMockPiazza() {
  const writes = [];
  const calls = [];

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    let body = "";
    for await (const chunk of req) body += chunk;
    const loggedIn = (req.headers.cookie || "").includes(SESSION);

    if (url.pathname === "/logic/api") {
      const { method, params } = JSON.parse(body);
      calls.push({ method, params });
      const reply = (result, error) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ result: result ?? null, error: error ?? null }));
      };
      if (!loggedIn) return reply(null, "You must be logged in");
      if (!["cs101nid", "old200nid", undefined].includes(params.nid)) return reply(null, "Bad network");
      switch (method) {
        case "user.status":
          return reply(status);
        case "network.search":
          return reply(feed.filter((p) => `${p.subject} ${p.content_snipet}`.toLowerCase().includes(params.query.toLowerCase())));
        case "content.get":
          return [12, "12", "p1"].includes(params.cid) ? reply(post) : reply(null, "Content not found");
        case "network.get_my_feed":
          return reply({ feed: feed.slice(params.offset, params.offset + params.limit) });
        case "network.filter_feed":
          if (params.folder) return reply({ feed: feed.filter((p) => p.folders.includes(params.filter_folder)) });
          if (params.updated) return reply({ feed: [feed[1]] });
          return reply({ feed: [] });
        default:
          if (method.startsWith("content.")) writes.push({ method, params });
          return reply(null, `Mock does not allow ${method}`);
      }
    }

    if (url.pathname === "/account/login") {
      // Simulates the user logging in a couple of seconds after the page opens.
      res.setHeader("Content-Type", "text/html");
      return res.end(`<html><body>Log in<script>
        setTimeout(() => { document.cookie = "${SESSION}; path=/"; }, 1500);
      </script></body></html>`);
    }

    if (url.pathname === "/main/csrf_token") {
      res.setHeader("Set-Cookie", "session_id=csrf123; Path=/");
      return res.end('CSRF_TOKEN = "csrf123";');
    }

    if (url.pathname === "/class" && req.method === "POST") {
      const form = new URLSearchParams(body);
      if (form.get("password") !== "right-password" || form.get("csrf_token") !== "csrf123") {
        return res.end('<script>var ERROR_MSG = "Email or password incorrect";</script>');
      }
      res.writeHead(302, { Location: "/class/cs101nid", "Set-Cookie": `${SESSION}; Path=/; HttpOnly` });
      return res.end();
    }

    if (url.pathname === "/example/fall2025/cs101/home") {
      return res.end(`<script>
        this.resource_data        = [{"subject":"Syllabus PDF","content":"/class_profile/get_resource/cs101nid/abc","config":{"section":"general","resource_type":"file"}},{"subject":"Textbook","content":"https://example.com/book","config":{"section":"general","resource_type":"link"}}];
      </script>`);
    }

    res.statusCode = 404;
    res.end("not found");
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, writes, calls, close: () => server.close() });
    });
  });
}
