import { ImageResponse } from "next/og";

/** The app icon (purple-pink gradient "100"), drawn at any size. T-0010. */
export function renderAppIcon(size: number, rounded = true) {
    return new ImageResponse(
        (
            <div
                style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "linear-gradient(135deg, #7c3aed 0%, #db2777 100%)",
                    borderRadius: rounded ? size * 0.22 : 0,
                    color: "white",
                    fontSize: size * 0.42,
                    fontWeight: 800,
                    letterSpacing: -size * 0.02,
                }}
            >
                100
            </div>
        ),
        { width: size, height: size }
    );
}
