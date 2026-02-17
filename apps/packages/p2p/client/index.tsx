import React from "react";
import ReactDOM from "react-dom/client";
import { P2PApp } from "./App.tsx";
import "./style.css";

const root = document.getElementById("root");
if (root) {
	ReactDOM.createRoot(root).render(
		<React.StrictMode>
			<P2PApp />
		</React.StrictMode>,
	);
}
