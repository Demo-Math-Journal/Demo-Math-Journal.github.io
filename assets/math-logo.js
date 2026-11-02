/*
 * Masthead logo: an animated wireframe of
 *   z = A sin(ax + t) cos(by + t/3)
 * drawn into #math-logo-surface. Moving the pointer over #math-logo (or
 * pressing the arrow keys while it has focus) changes a, b, A and the
 * viewing angle; #math-logo-readout shows the current values. The drift
 * over t stops under prefers-reduced-motion, but the pointer and keys
 * still reshape the surface.
 */
(() => {
  const root = document.querySelector("#math-logo");
  const surface = document.querySelector("#math-logo-surface");
  const readout = document.querySelector("#math-logo-readout");

  if (!root || !surface) return;

  const SVG_NS = "http://www.w3.org/2000/svg";

  const prefersReducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  );

  let pointerX = 0.5;
  let pointerY = 0.5;

  let phase = 0;
  let lastTime = performance.now();

  const colors = {
    dark: "#173f68",
    medium: "#28699f",
    light: "#72a9ce"
  };

  const createPath = ({
    d,
    stroke,
    width = 1,
    opacity = 1
  }) => {
    const path = document.createElementNS(SVG_NS, "path");

    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", stroke);
    path.setAttribute("stroke-width", width);
    path.setAttribute("stroke-opacity", opacity);
    path.setAttribute("vector-effect", "non-scaling-stroke");

    return path;
  };


  const getParameters = () => ({
    a: 1.15 + pointerX * 0.55,
    b: 1.05 + (1 - pointerY) * 0.45,
    amplitude: 0.72 + pointerY * 0.18
  });


  const updateReadout = () => {
    if (!readout) return;

    const { a, b } = getParameters();

    readout.textContent =
      `a = ${a.toFixed(2)} · b = ${b.toFixed(2)}`;
  };


  const project = (x, y, z) => {
    const rotation = -0.72 + (pointerX - 0.5) * 0.12;

    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);

    const xr = x * cos - y * sin;
    const yr = x * sin + y * cos;

    return [
      120 + xr * 31,
      83 + yr * 14 - z * 32
    ];
  };


  const draw = () => {
    surface.replaceChildren();

    const {
      a,
      b,
      amplitude
    } = getParameters();

    const z = (x, y) =>
      amplitude *
      Math.sin(a * x + phase) *
      Math.cos(b * y + phase * 0.35);


    /*
     * Lines running across Y.
     */

    for (let row = -8; row <= 8; row += 1) {
      const y = row / 2.4;
      let d = "";

      for (let point = -40; point <= 40; point += 1) {
        const x = point / 10;

        const [screenX, screenY] = project(
          x,
          y,
          z(x, y)
        );

        d += `${
          point === -40 ? "M" : "L"
        }${screenX.toFixed(2)},${screenY.toFixed(2)}`;
      }

      surface.append(
        createPath({
          d,
          stroke: colors.dark,
          width: 0.8,
          opacity: 0.35
        })
      );
    }


    /*
     * Lines running across X.
     * Alternating blues add depth without introducing
     * another color family.
     */

    for (let column = -8; column <= 8; column += 1) {
      const x = column / 2.4;
      let d = "";

      for (let point = -40; point <= 40; point += 1) {
        const y = point / 10;

        const [screenX, screenY] = project(
          x,
          y,
          z(x, y)
        );

        d += `${
          point === -40 ? "M" : "L"
        }${screenX.toFixed(2)},${screenY.toFixed(2)}`;
      }

      surface.append(
        createPath({
          d,
          stroke:
            column % 2 === 0
              ? colors.medium
              : colors.light,

          width:
            column % 2 === 0
              ? 1.25
              : 0.9,

          opacity:
            column % 2 === 0
              ? 0.8
              : 0.58
        })
      );
    }
  };


  const animate = (time) => {
    const elapsed = Math.min(
      (time - lastTime) / 1000,
      0.1
    );

    lastTime = time;

    if (!prefersReducedMotion.matches) {
      /*
       * ~35 seconds for a full 2π cycle.
       */

      phase += elapsed * 0.18;
    }

    draw();

    requestAnimationFrame(animate);
  };


  root.addEventListener("pointermove", event => {
    const bounds = root.getBoundingClientRect();

    pointerX =
      (event.clientX - bounds.left) /
      bounds.width;

    pointerY =
      (event.clientY - bounds.top) /
      bounds.height;

    pointerX = Math.max(
      0,
      Math.min(1, pointerX)
    );

    pointerY = Math.max(
      0,
      Math.min(1, pointerY)
    );

    updateReadout();
  });


  root.addEventListener("keydown", event => {
    const step = 0.04;

    switch (event.key) {
      case "ArrowLeft":
        pointerX -= step;
        break;

      case "ArrowRight":
        pointerX += step;
        break;

      case "ArrowUp":
        pointerY -= step;
        break;

      case "ArrowDown":
        pointerY += step;
        break;

      default:
        return;
    }

    event.preventDefault();

    pointerX = Math.max(
      0,
      Math.min(1, pointerX)
    );

    pointerY = Math.max(
      0,
      Math.min(1, pointerY)
    );

    updateReadout();
    draw();
  });


  updateReadout();
  draw();

  requestAnimationFrame(animate);
})();
