/**
 * flow.js — renders the SVG request path and animates a "packet" along it.
 *
 * The four nodes mirror a real request path: your app never talks to the
 * database directly — it goes through a gateway (auth + rate limiting)
 * and a backend service (business logic) first. Forward and backward
 * trips both walk the same curves, just in opposite directions, so the
 * diagram never lies about which hop the response is coming back through.
 */
(function () {
  const NODES = [
    { id: "client", x: 50, y: 110, label: "Your app", sub: "client" },
    { id: "gateway", x: 210, y: 60, label: "API gateway", sub: "auth + rate limit" },
    { id: "service", x: 370, y: 160, label: "Backend service", sub: "business logic" },
    { id: "db", x: 530, y: 60, label: "Database", sub: "stored records" },
  ];

  let svg, packet, segEls;

  function pointOnPath(pathEl, t) {
    const len = pathEl.getTotalLength();
    return pathEl.getPointAtLength(len * Math.min(Math.max(t, 0), 1));
  }

  function build(svgEl) {
    svg = svgEl;
    const defs = [];
    for (let i = 0; i < NODES.length - 1; i++) {
      const a = NODES[i], b = NODES[i + 1];
      const c1x = a.x + (b.x - a.x) * 0.5, c1y = a.y;
      const c2x = a.x + (b.x - a.x) * 0.5, c2y = b.y;
      defs.push(`M ${a.x} ${a.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${b.x} ${b.y}`);
    }

    let markup = "";
    defs.forEach((d, i) => { markup += `<path class="flow-path" id="seg${i}" d="${d}"></path>`; });
    NODES.forEach((n) => {
      markup += `
        <g>
          <circle class="node-circle" id="circle-${n.id}" cx="${n.x}" cy="${n.y}" r="22"></circle>
          <text class="node-label" x="${n.x}" y="${n.y + 38}" text-anchor="middle">${n.label}</text>
          <text class="node-sub" x="${n.x}" y="${n.y + 50}" text-anchor="middle">${n.sub}</text>
        </g>`;
    });
    markup += `<circle id="packet" class="packet" r="6" opacity="0"></circle>`;

    svg.innerHTML = markup;
    packet = svg.querySelector("#packet");
    segEls = defs.map((_, i) => svg.querySelector("#seg" + i));
  }

  function resetVisualState() {
    NODES.forEach((n) => {
      svg.querySelector("#circle-" + n.id).classList.remove("active", "done", "error");
    });
    segEls.forEach((s) => s.classList.remove("request-lit", "response-lit", "error-lit"));
    packet.setAttribute("opacity", "0");
  }

  function setNode(id, state) {
    const c = svg.querySelector("#circle-" + id);
    c.classList.remove("active", "done", "error");
    if (state) c.classList.add(state);
  }

  function litSeg(i, cls) {
    if (segEls[i]) segEls[i].classList.add(cls);
  }

  /**
   * Walk forward from node 0 to node `toIndex`. If `isError` is true, the
   * final node is marked as the point of failure (e.g. the gateway
   * rejecting an unauthenticated request, or the backend crashing).
   */
  function animateForward({ toIndex, isError, duration, onEnterNode }) {
    return new Promise((resolve) => {
      packet.setAttribute("opacity", "1");
      packet.setAttribute("class", "packet " + (isError ? "error" : "request"));
      packet.setAttribute("fill", isError ? "#d9695f" : "#7c93ff");

      setNode(NODES[0].id, "active");
      onEnterNode && onEnterNode(0, false);

      let segIndex = 0;
      let startTime = null;
      const segCount = toIndex;

      function frame(ts) {
        if (!startTime) startTime = ts;
        const segDuration = duration / segCount;
        const elapsed = ts - startTime - segIndex * segDuration;
        let t = elapsed / segDuration;

        if (t >= 1) {
          setNode(NODES[segIndex].id, "done");
          litSeg(segIndex, "request-lit");
          segIndex++;
          const isLast = segIndex >= segCount;
          setNode(NODES[segIndex].id, isLast && isError ? "error" : "active");
          onEnterNode && onEnterNode(segIndex, isLast && isError);
          if (isLast) {
            packet.setAttribute("opacity", "0");
            resolve();
            return;
          }
          startTime = ts - segIndex * segDuration;
          t = 0;
        }

        const p = pointOnPath(segEls[segIndex], t);
        packet.setAttribute("cx", p.x);
        packet.setAttribute("cy", p.y);
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  }

  /**
   * Walk backward from node `fromIndex` down to node 0, retracing the
   * same curves in reverse — this is what makes the return trip look
   * like a real response coming back rather than a re-run of the request.
   */
  function animateBackward({ fromIndex, isError, duration, onEnterNode }) {
    return new Promise((resolve) => {
      packet.setAttribute("opacity", "1");
      packet.setAttribute("class", "packet " + (isError ? "error" : "response"));
      packet.setAttribute("fill", isError ? "#d9695f" : "#3fa876");

      let segIndex = fromIndex - 1;
      let doneCount = 0;
      let startTime = null;
      const segCount = fromIndex;

      function frame(ts) {
        if (!startTime) startTime = ts;
        const segDuration = duration / segCount;
        const elapsed = ts - startTime - doneCount * segDuration;
        let t = elapsed / segDuration;

        if (t >= 1) {
          litSeg(segIndex, isError ? "error-lit" : "response-lit");
          setNode(NODES[segIndex].id, isError ? "error" : "done");
          doneCount++;
          segIndex--;
          const isLast = doneCount >= segCount;
          if (isLast) {
            setNode(NODES[0].id, isError ? "error" : "done");
            packet.setAttribute("opacity", "0");
            onEnterNode && onEnterNode(0, isError);
            resolve();
            return;
          }
          onEnterNode && onEnterNode(segIndex, false);
          startTime = ts - doneCount * segDuration;
          t = 0;
        }

        const p = pointOnPath(segEls[segIndex], 1 - t);
        packet.setAttribute("cx", p.x);
        packet.setAttribute("cy", p.y);
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
  }

  window.FlowDiagram = { NODES, build, resetVisualState, animateForward, animateBackward };
})();
