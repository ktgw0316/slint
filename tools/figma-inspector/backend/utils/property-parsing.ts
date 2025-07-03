// Copyright © SixtyFPS GmbH <info@slint.dev>
// SPDX-License-Identifier: GPL-3.0-only OR LicenseRef-Slint-Royalty-free-2.0 OR LicenseRef-Slint-Software-3.0
import {
    formatStructName,
    extractHierarchy,
    sanitizePropertyName,
} from "./export-variables";

export const indentation = "    ";

const sharedNodeProperties = [
    "children",
    "x",
    "y",
    "width",
    "height",

    "maxWidth", // "max-width",
    "maxHeight", // "max-height",
    "minWidth",  // "min-width",
    "minHeight", // "min-height",

    "itemSpacing",    // "spacing",

    "layoutAlign",

    "paddingLeft",    // "padding-left",
    "paddingRight",   // "padding-right",
    "paddingTop",     // "padding-top",
    "paddingBottom",  // "padding-bottom",

    "opacity",
];

const rectangleProperties = [
    "border-radius",
    "border-width",
    "border-color",
    "fills",
];

const textProperties = [
    "text",
    "fills",
    "font-family",
    "font-size",
    "font-weight",
    "horizontal-alignment",
];

// const frameNodeProperties = [
// "col",
// "row",
// "colspan",
// "rowspan",
// "horizontal-stretch",
// "vertical-stretch",
// "preferred-width",
// "preferred-height",
// ];

const pathProperties = [
    "commands",
    "fills",
    "stroke",
    "stroke-width",
];

export function rgbToHex(rgba: RGB | RGBA): string {
    const red = Math.round(rgba.r * 255);
    const green = Math.round(rgba.g * 255);
    const blue = Math.round(rgba.b * 255);
    const alphaF = "a" in rgba ? rgba.a : 1;
    const alpha = Math.round(alphaF * 255);

    const values = alphaF < 1 ? [red, green, blue, alpha] : [red, green, blue];
    return "#" + values.map((x) => x.toString(16).padStart(2, "0")).join("");
}

export function generateRadialGradient(fill: {
    opacity: number;
    gradientStops: ReadonlyArray<{
        color: { r: number; g: number; b: number; a: number };
        position: number;
    }>;
    gradientTransform: number[][];
}): string {
    if (!fill.gradientStops || fill.gradientStops.length < 2) {
        return "";
    }

    const stops = fill.gradientStops
        .map((stop) => {
            const { r, g, b, a } = stop.color;
            const hexColor = rgbToHex({ r, g, b, a });
            const position = Math.round(stop.position * 100);

            return `${hexColor} ${position}%`;
        })
        .join(", ");

    return `@radial-gradient(circle, ${stops})`;
}

export function generateLinearGradient(fill: {
    opacity: number;
    gradientStops: ReadonlyArray<{ color: RGBA; position: number }>;
    gradientTransform: number[][];
}): string {
    if (!fill.gradientStops || fill.gradientStops.length < 2) {
        return "";
    }

    const [a, b] = fill.gradientTransform[0];
    const angle = (90 + Math.round(Math.atan2(b, a) * (180 / Math.PI))) % 360;

    const stops = fill.gradientStops
        .map((stop) => {
            const { r, g, b, a } = stop.color;
            const hexColor = rgbToHex({ r, g, b, a });
            const position = Math.round(stop.position * 100);

            return `${hexColor} ${position}%`;
        })
        .join(", ");

    return `@linear-gradient(${angle}deg, ${stops})`;
}

function roundNumber(value: number): number | null {
    if (value === 0) {
        return null;
    }
    return Number(value.toFixed(3));
}

export async function getBorderRadius(
    node: SceneNode,
    useVariables: boolean,
): Promise<string | null> {
    if (node.type === "ELLIPSE") {
        return `${indentation}border-radius: self.width/2;`;
    }

    if ("boundVariables" in node) {
        const boundVars = (node as any).boundVariables;
        const boundCornerRadiusId = boundVars?.cornerRadius?.id;
        if (boundCornerRadiusId && useVariables) {
            const path = await getVariablePathString(boundCornerRadiusId);
            if (path) {
                return `${indentation}border-radius: ${path};`;
            }
        }

        const cornerBindings = [
            {
                prop: "topLeftRadius",
                slint: "border-top-left-radius",
                id: boundVars?.topLeftRadius?.id,
            },
            {
                prop: "topRightRadius",
                slint: "border-top-right-radius",
                id: boundVars?.topRightRadius?.id,
            },
            {
                prop: "bottomLeftRadius",
                slint: "border-bottom-left-radius",
                id: boundVars?.bottomLeftRadius?.id,
            },
            {
                prop: "bottomRightRadius",
                slint: "border-bottom-right-radius",
                id: boundVars?.bottomRightRadius?.id,
            },
        ] as const;

        const boundIndividualCorners = cornerBindings.filter((c) => c.id);

        if (boundIndividualCorners.length > 0 && useVariables) {
            // --- Check if all bound corners use the SAME variable ID ---
            const allSameId = boundIndividualCorners.every(
                (c) => c.id === boundIndividualCorners[0].id,
            );

            if (allSameId && boundIndividualCorners.length === 4) {
                // All 4 corners bound to the same variable -> use shorthand border-radius
                const path = await getVariablePathString(
                    boundIndividualCorners[0].id,
                );
                if (path) {
                    return `${indentation}border-radius: ${path};`;
                }
            } else {
                const radiusStrings: string[] = [];
                for (const corner of boundIndividualCorners) {
                    const path = await getVariablePathString(corner.id);
                    if (path) {
                        radiusStrings.push(
                            `${indentation}${corner.slint}: ${path};`,
                        );
                    }
                }
                if (radiusStrings.length > 0) {
                    return radiusStrings.join("\n");
                }
            }
        }
    }
    // check if node has cornerRadius property
    if (node === null || !("cornerRadius" in node) || node.cornerRadius === 0) {
        return null;
    }

    const roundRadius = (value: number) => {
        return Number(value.toFixed(3));
    };

    const cornerRadius = node.cornerRadius;

    if (typeof cornerRadius === "number") {
        return `${indentation}border-radius: ${roundRadius(cornerRadius)}px;`;
    }

    // Create type guard for corner properties
    type NodeWithCorners = {
        topLeftRadius?: number | symbol;
        topRightRadius?: number | symbol;
        bottomLeftRadius?: number | symbol;
        bottomRightRadius?: number | symbol;
    };

    // Check if node has the corner properties
    const hasCornerProperties = (
        node: SceneNode,
    ): node is SceneNode & NodeWithCorners => {
        return (
            "topLeftRadius" in node ||
            "topRightRadius" in node ||
            "bottomLeftRadius" in node ||
            "bottomRightRadius" in node
        );
    };

    if (!hasCornerProperties(node)) {
        return null;
    }

    const corners = [
        { prop: "topLeftRadius", slint: "border-top-left-radius" },
        { prop: "topRightRadius", slint: "border-top-right-radius" },
        { prop: "bottomLeftRadius", slint: "border-bottom-left-radius" },
        { prop: "bottomRightRadius", slint: "border-bottom-right-radius" },
    ] as const;

    const validCorners = corners.filter((corner) => {
        const value = node[corner.prop as keyof typeof node];
        return typeof value === "number" && value > 0;
    });

    const radiusStrings = validCorners.map((corner) => {
        const value = node[corner.prop as keyof typeof node] as number;
        return `${indentation}${corner.slint}: ${roundRadius(value)}px;`;
    });

    return radiusStrings.length > 0 ? radiusStrings.join("\n") : null;
}

export async function getBorderWidthAndColor(
    sceneNode: SceneNode,
    useVariables: boolean,
): Promise<string[] | null> {
    const properties: string[] = [];
    if (
        !("strokes" in sceneNode) ||
        !Array.isArray(sceneNode.strokes) ||
        sceneNode.strokes.length === 0
    ) {
        return null;
    }

    const firstStroke = sceneNode.strokes[0];

    // Border Width (check variable binding)
    const boundWidthVarId = firstStroke.boundVariables?.strokeWeight?.id;
    let borderWidthValue: string | null = null;

    if (boundWidthVarId && useVariables) {
        borderWidthValue = await getVariablePathString(boundWidthVarId);
    }
    // Fallback or if not bound
    if (
        !borderWidthValue &&
        "strokeWeight" in sceneNode &&
        typeof sceneNode.strokeWeight === "number"
    ) {
        const width = roundNumber(sceneNode.strokeWeight);
        if (width) {
            borderWidthValue = `${width}px`;
        }
    }
    if (borderWidthValue) {
        properties.push(`${indentation}border-width: ${borderWidthValue};`);
    }

    // Border Color (check variable binding)
    const boundColorVarId = firstStroke.boundVariables?.color?.id;
    let borderColorValue: string | null = null;

    if (boundColorVarId && useVariables) {
        borderColorValue = await getVariablePathString(boundColorVarId);
    }
    // Fallback or if not bound
    if (!borderColorValue) {
        borderColorValue = getBrush(firstStroke); // Use existing function for resolved color
    }

    if (borderColorValue) {
        properties.push(`${indentation}border-color: ${borderColorValue};`);
    }

    return properties.length > 0 ? properties : null;
}

export function getBrush(fill: {
    type: string;
    opacity?: number; // Allow opacity to be optional
    color?: { r: number; g: number; b: number };
    gradientStops?: ReadonlyArray<{
        color: { r: number; g: number; b: number; a: number };
        position: number;
    }>;
    gradientTransform?: number[][];
}): string | null {
    const opacity = fill.opacity ?? 1; // Default to 1 if opacity is undefined

    switch (fill.type) {
        case "SOLID": {
            if (!fill.color) {
                console.warn("Missing fill colors for solid color value");
                return "";
            }
            return rgbToHex({ ...fill.color, a: opacity });
        }
        case "GRADIENT_LINEAR": {
            if (!fill.gradientStops || !fill.gradientTransform) {
                console.warn("Missing gradient stops for linear gradient");
                return "";
            }
            return generateLinearGradient({
                opacity: opacity,
                gradientStops: fill.gradientStops,
                gradientTransform: fill.gradientTransform,
            });
        }
        case "GRADIENT_RADIAL": {
            if (!fill.gradientStops || !fill.gradientTransform) {
                return "";
            }
            return generateRadialGradient({
                opacity: opacity,
                gradientStops: fill.gradientStops,
                gradientTransform: fill.gradientTransform,
            });
        }
        default: {
            console.warn("Unknown fill type:", fill.type);
            return null;
        }
    }
}

async function getVariablePathString(
    variableId: string,
): Promise<string | null> {
    const variable = await figma.variables.getVariableByIdAsync(variableId);
    if (variable) {
        const collection = await figma.variables.getVariableCollectionByIdAsync(
            variable.variableCollectionId,
        );
        if (collection) {
            const globalName = formatStructName(collection.name);
            const pathParts = extractHierarchy(variable.name);
            const slintPath = pathParts.map(sanitizePropertyName).join(".");
            let resultPath = "";
            if (collection.modes.length > 1) {
                resultPath = `${globalName}.current.${slintPath}`;
            } else {
                resultPath = `${globalName}.${slintPath}`;
            }

            return resultPath;
        }
        console.warn(
            `[getVariablePathString] Collection not found for variable ID: ${variableId}`,
        );
    }
    return null;
}

export async function generateSlintSnippet(
    sceneNode: SceneNode,
    useVariables: boolean,
): Promise<string> {
    const nodeType = sceneNode.type;

    switch (nodeType) {
        case "FRAME":
            return await generateFrameSnippet(sceneNode, useVariables);
        case "RECTANGLE":
        case "ELLIPSE":
        case "GROUP":
            return await generateRectangleSnippet(sceneNode, useVariables);
        case "COMPONENT":
            return await generateRectangleSnippet(sceneNode, useVariables);
        case "INSTANCE":
            return await generateInstanceSnippet(sceneNode);
        case "TEXT":
            return await generateTextSnippet(sceneNode, useVariables);
        case "LINE":
        case "VECTOR":
            return await generatePathNodeSnippet(sceneNode, useVariables);
        default:
            return await generateUnsupportedNodeSnippet(sceneNode, useVariables);
    }
}

function slintAlignmentFrom(layoutAlign: AutoLayoutChildrenMixin["layoutAlign"]): string {
    let alignment: string;
    switch (layoutAlign) {
        case "MIN":
            alignment = "start";
            break;
        case "CENTER":
            alignment = "center";
            break;
        case "MAX":
            alignment = "end";
            break;
        case "STRETCH":
            alignment = "stretch";
            break;
        case "INHERIT":
        default:
            alignment = "space-between";
            break;
    }
    return `alignment: ${alignment};`;
}

async function getFillValue(sceneNode: SceneNode, useVariables: boolean) : Promise<string | null> {
    if (
        "fills" in sceneNode &&
        Array.isArray(sceneNode.fills) &&
        sceneNode.fills.length > 0 &&
        sceneNode.fills[0].visible !== false
    ) {
        const firstFill = sceneNode.fills[0] as Paint;
        if (firstFill.type === "SOLID") {
            let fillValue: string | null = null;
            if (useVariables) {
                const boundVarId = firstFill.boundVariables?.color?.id;
                if (boundVarId) {
                    fillValue = await getVariablePathString(boundVarId);
                }
                if (fillValue) {
                    return fillValue;
                }
            }
        }
        return getBrush(firstFill);
    }
    return null;
}

async function pushSharedNodeProperties(
    properties: string[],
    sceneNode: SceneNode,
    useVariables: boolean,
) {
    for (const property of sharedNodeProperties) {
        try {
            switch (property) {
                case "x":
                    const boundXVarId = (sceneNode as any).boundVariables?.x
                        ?.id;
                    let xValue: string | null = null;
                    if (boundXVarId && useVariables) {
                        xValue = await getVariablePathString(boundXVarId);
                    }
                    // use number value
                    if (
                        !xValue &&
                        "x" in sceneNode &&
                        typeof sceneNode.x === "number"
                    ) {
                        const x = sceneNode.x; // Get raw value
                        if (x === 0) {
                            // Explicitly handle 0
                            xValue = "0px";
                        } else {
                            const roundedX = roundNumber(x); // Use roundNumber for non-zero
                            if (roundedX !== null) {
                                xValue = `${roundedX}px`;
                            }
                        }
                    }
                    if (xValue && sceneNode.parent?.type !== "PAGE") {
                        properties.push(`${indentation}x: ${xValue};`);
                    }
                    break;

                case "y":
                    const boundYVarId = (sceneNode as any).boundVariables?.y
                        ?.id;
                    let yValue: string | null = null;
                    if (boundYVarId && useVariables) {
                        yValue = await getVariablePathString(boundYVarId);
                    }
                    // use number value
                    if (
                        !yValue &&
                        "y" in sceneNode &&
                        typeof sceneNode.y === "number"
                    ) {
                        const y = sceneNode.y; // Get raw value
                        if (y === 0) {
                            // Explicitly handle 0
                            yValue = "0px";
                        } else {
                            const roundedY = roundNumber(y); // Use roundNumber for non-zero
                            if (roundedY !== null) {
                                yValue = `${roundedY}px`;
                            }
                        }
                    }
                    // --- End modification ---
                    if (yValue && sceneNode.parent?.type !== "PAGE") {
                        // Keep parent check
                        properties.push(`${indentation}y: ${yValue};`);
                    }
                    break;
                case "width":
                    const boundWidthVarId = (sceneNode as any).boundVariables
                        ?.width?.id;
                    let widthValue: string | null = null;
                    if (boundWidthVarId && useVariables) {
                        widthValue =
                            await getVariablePathString(boundWidthVarId);
                    }
                    if (!widthValue && "width" in sceneNode) {
                        const normalizedWidth = roundNumber(sceneNode.width);
                        if (normalizedWidth) {
                            widthValue = `${normalizedWidth}px`;
                        }
                    }
                    if (widthValue) {
                        properties.push(`${indentation}width: ${widthValue};`);
                    }
                    break;
                case "height":
                    const boundHeightVarId = (sceneNode as any).boundVariables
                        ?.height?.id;
                    let heightValue: string | null = null;
                    if (boundHeightVarId && useVariables) {
                        heightValue =
                            await getVariablePathString(boundHeightVarId);
                    }
                    if (!heightValue && "height" in sceneNode) {
                        const normalizedHeight = roundNumber(sceneNode.height);
                        if (normalizedHeight) {
                            heightValue = `${normalizedHeight}px`;
                        }
                    }
                    if (heightValue) {
                        properties.push(
                            `${indentation}height: ${heightValue};`,
                        );
                    }
                    break;
                case "maxWidth":
                    if ("maxWidth" in sceneNode && typeof sceneNode.maxWidth === "number") {
                        const maxWidth = roundNumber(sceneNode.maxWidth);
                        if (maxWidth) {
                            properties.push(`${indentation}max-width: ${maxWidth}px;`);
                        }
                    }
                    break;
                case "maxHeight":
                    if ("maxHeight" in sceneNode && typeof sceneNode.maxHeight === "number") {
                        const maxHeight = roundNumber(sceneNode.maxHeight);
                        if (maxHeight) {
                            properties.push(`${indentation}max-height: ${maxHeight}px;`);
                        }
                    }
                    break;
                case "minHeight":
                    if ("minHeight" in sceneNode && typeof sceneNode.minHeight === "number") {
                        const minHeight = roundNumber(sceneNode.minHeight);
                        if (minHeight) {
                            properties.push(`${indentation}min-height: ${minHeight}px;`);
                        }
                    }
                    break;
                case "minWidth":
                    if ("minWidth" in sceneNode && typeof sceneNode.minWidth === "number") {
                        const minWidth = roundNumber(sceneNode.minWidth);
                        if (minWidth) {
                            properties.push(`${indentation}min-width: ${minWidth}px;`);
                        }
                    }
                    break;
                case "itemSpacing":
                    if ("itemSpacing" in sceneNode && typeof sceneNode.itemSpacing === "number") {
                        const itemSpacing = roundNumber(sceneNode.itemSpacing);
                        if (itemSpacing) {
                            properties.push(`${indentation}spacing: ${itemSpacing}px;`);
                        }
                    }
                    break;
                case "layoutAlign":
                    if ("layoutAlign" in sceneNode && typeof sceneNode.layoutAlign === "string") {
                        const alignment = slintAlignmentFrom(sceneNode.layoutAlign);
                        properties.push(`${indentation}${alignment}`);
                    }
                    break;
                case "paddingLeft":
                    if ("paddingLeft" in sceneNode && typeof sceneNode.paddingLeft === "number") {
                        const paddingLeft = roundNumber(sceneNode.paddingLeft);
                        if (paddingLeft) {
                            properties.push(`${indentation}padding-left: ${paddingLeft}px;`);
                        }
                    }
                    break;
                case "paddingRight":
                    if ("paddingRight" in sceneNode && typeof sceneNode.paddingRight === "number") {
                        const paddingRight = roundNumber(sceneNode.paddingRight);
                        if (paddingRight) {
                            properties.push(`${indentation}padding-right: ${paddingRight}px;`);
                        }
                    }
                    break;
                case "paddingTop":
                    if ("paddingTop" in sceneNode && typeof sceneNode.paddingTop === "number") {
                        const paddingTop = roundNumber(sceneNode.paddingTop);
                        if (paddingTop) {
                            properties.push(`${indentation}padding-top: ${paddingTop}px;`);
                        }
                    }
                    break;
                case "paddingBottom":
                    if ("paddingBottom" in sceneNode && typeof sceneNode.paddingBottom === "number") {
                        const paddingBottom = roundNumber(sceneNode.paddingBottom);
                        if (paddingBottom) {
                            properties.push(`${indentation}padding-bottom: ${paddingBottom}px;`);
                        }
                    }
                    break;
                case "opacity":
                    if ("opacity" in sceneNode && sceneNode.opacity !== 1) {
                        properties.push(
                            `${indentation}opacity: ${Math.round(sceneNode.opacity * 100)}%;`,
                        );
                    }
                    break;
            }
        } catch (err) {
            console.error(
                `[generateRectangleSnippet] Error processing property "${property}":`,
                err,
            );
            properties.push(
                `${indentation}// Error processing ${property}: ${err instanceof Error ? err.message : err}`,
            );
        }
    }
}

export async function generateUnsupportedNodeSnippet(
    sceneNode: SceneNode,
    useVariables: boolean,
): Promise<string> {
    const properties: string[] = [];
    const nodeType = sceneNode.type;

    await pushSharedNodeProperties(properties, sceneNode, useVariables);
    await pushChildrenProperties(properties, sceneNode, useVariables);

    return `//Unsupported type: ${nodeType}\nRectangle {\n${properties.join("\n")}\n}`;
}

export async function generateRectangleSnippet(
    sceneNode: SceneNode,
    useVariables: boolean,
): Promise<string> {
    const properties: string[] = [];
    const nodeId = sanitizePropertyName(sceneNode.name);

    await pushSharedNodeProperties(properties, sceneNode, useVariables);

    for (const property of rectangleProperties) {
        try {
            switch (property) {
                case "border-radius":
                    const borderRadiusProp = await getBorderRadius(
                        sceneNode,
                        useVariables,
                    );
                    if (borderRadiusProp !== null) {
                        properties.push(borderRadiusProp);
                    }
                    break;
                case "border-width":
                    const borderWidthAndColor = await getBorderWidthAndColor(
                        sceneNode,
                        useVariables,
                    );
                    if (borderWidthAndColor !== null) {
                        properties.push(...borderWidthAndColor);
                    }
                    break;
                case "border-color":
                    // Handled in border-width
                    break;
                case "fills":
                    const fillValue = await getFillValue(sceneNode, useVariables);
                    if (fillValue) {
                        properties.push(`${indentation}background: ${fillValue};`);
                    }
                    break;
            }
        } catch (err) {
            console.error(
                `[generateRectangleSnippet] Error processing property "${property}":`,
                err,
            );
            properties.push(
                `${indentation}// Error processing ${property}: ${err instanceof Error ? err.message : err}`,
            );
        }
    }

    await pushChildrenProperties(properties, sceneNode, useVariables);

    return `${nodeId} := Rectangle {\n${properties.join("\n")}\n}`;
}

async function pushChildrenProperties(
    properties: string[],
    sceneNode: SceneNode,
    useVariables: boolean,
) {
    if ("children" in sceneNode && Array.isArray(sceneNode.children)) {
        for (const child of sceneNode.children) {
            const childSnippet = await generateSlintSnippet(child, useVariables);
            properties.push(`${indentation}${childSnippet}`);
        }
    }
}

export async function generateFrameSnippet(
    sceneNode: FrameNode,
    useVariables: boolean,
): Promise<string> {
    const nodeId = sanitizePropertyName(sceneNode.name);

    let layout: string;
    switch (sceneNode.layoutMode) {
        case "HORIZONTAL":
            layout = "HorizontalLayout";
            break;
        case "VERTICAL":
            layout = "VerticalLayout";
            break;
        case "NONE":
        default:
            layout = "Rectangle";
            break;
    }

    const properties: string[] = [];
    await pushSharedNodeProperties(properties, sceneNode, useVariables);
    await pushChildrenProperties(properties, sceneNode, useVariables);

    return `// ${nodeId}\n${layout} {\n${properties.join("\n")}\n}`;
}

export async function generateInstanceSnippet(sceneNode: InstanceNode): Promise<string> {
    const nodeId = sanitizePropertyName(sceneNode.name);
    const mainComponent = await sceneNode.getMainComponentAsync();

    if (mainComponent) {
        const mainComponentName = mainComponent.parent?.name;
        return `// ${nodeId}\n${indentation}${mainComponentName} {}`;
    } else {
        return `// Main component not found for instance: ${nodeId}`;
    }
}

export async function generatePathNodeSnippet(
    sceneNode: SceneNode,
    useVariables: boolean,
): Promise<string> {
    const properties: string[] = [];
    const nodeId = sanitizePropertyName(sceneNode.name);

    await pushSharedNodeProperties(properties, sceneNode, useVariables);

    for (const property of pathProperties) {
        try {
            switch (property) {
                case "commands":
                    if (!(sceneNode.type === "VECTOR" || sceneNode.type === "LINE")) {
                        break;
                    }
                    try {
                        const svgString = await sceneNode.exportAsync({
                            format: "SVG_STRING",
                        });
                        let pathCommands: string | null = null;
                        if (sceneNode.type === "VECTOR") {
                            const match = svgString.match(
                                /<path[^>]*d=(["'])(.*?)\1/,
                            );
                            if (match && match[2]) {
                                pathCommands = match[2];
                            }
                        } else if (sceneNode.type === "LINE") {
                            const match = svgString.match(
                                /<line[^>]*y1=(["'])(.*?)\1[^>]*x2=(["'])(.*?)\3[^>]*y2=(["'])(.*?)\5/,
                            );
                            if (match && match[2] && match[4] && match[6]) {
                                const x1 = 0;
                                const y1 = match[2];
                                const x2 = match[4];
                                const y2 = match[6];
                                pathCommands = `M${x1} ${y1}L${x2} ${y2}`;
                            }
                        }
                        if (pathCommands) {
                            properties.push(
                                `${indentation}commands: "${pathCommands}";`,
                            );
                        } else {
                            console.warn(
                                "[generatePathNodeSnippet] Could not extract path commands from SVG for node:",
                                sceneNode.id,
                            );
                            properties.push(
                                `${indentation}// Could not extract path commands from SVG`,
                                `${indentation}// ${svgString}`,
                            );
                        }
                    } catch (e) {
                        console.error(
                            "[generatePathNodeSnippet] Error exporting SVG for node:",
                            sceneNode.id,
                            e,
                        );
                        properties.push(
                            `${indentation}// Error exporting SVG: ${e instanceof Error ? e.message : e}`,
                        );
                    }
                    break;
                case "fills":
                    const fillValue = await getFillValue(sceneNode, useVariables);
                    if (fillValue) {
                        properties.push(`${indentation}fill: ${fillValue};`);
                    }
                    break;
                case "stroke":
                    if (
                        "strokes" in sceneNode &&
                        Array.isArray(sceneNode.strokes) &&
                        sceneNode.strokes.length > 0 &&
                        sceneNode.strokes[0].visible !== false
                    ) {
                        const firstStroke = sceneNode.strokes[0] as Paint;
                        const boundColorVarId = (firstStroke as any)
                            .boundVariables?.color?.id;
                        let strokeValue: string | null = null;
                        if (boundColorVarId && useVariables) {
                            strokeValue =
                                await getVariablePathString(boundColorVarId);
                        }
                        if (!strokeValue) {
                            strokeValue = getBrush(firstStroke);
                        }
                        if (strokeValue) {
                            properties.push(
                                `${indentation}stroke: ${strokeValue};`,
                            );
                        }
                    }
                    break;
                case "stroke-width":
                    const boundSWVarId = (sceneNode as any).boundVariables
                        ?.strokeWeight?.id;
                    let strokeWValue: string | null = null;
                    if (boundSWVarId && useVariables) {
                        strokeWValue =
                            await getVariablePathString(boundSWVarId);
                    }
                    if (
                        !strokeWValue &&
                        "strokeWeight" in sceneNode &&
                        typeof sceneNode.strokeWeight === "number"
                    ) {
                        const sw = sceneNode.strokeWeight;
                        if (sw === 0) {
                            strokeWValue = "0px";
                        } else {
                            const roundedSw = roundNumber(sw);
                            if (roundedSw !== null) {
                                strokeWValue = `${roundedSw}px`;
                            }
                        }
                    }
                    if (strokeWValue) {
                        if (strokeWValue !== "0px") {
                            if (
                                "strokes" in sceneNode &&
                                Array.isArray(sceneNode.strokes) &&
                                sceneNode.strokes.some(
                                    (s) => s.visible !== false,
                                )
                            ) {
                                properties.push(
                                    `${indentation}stroke-width: ${strokeWValue};`,
                                );
                            }
                        } else {
                            if (
                                "strokes" in sceneNode &&
                                Array.isArray(sceneNode.strokes) &&
                                sceneNode.strokes.some(
                                    (s) => s.visible !== false,
                                )
                            ) {
                                properties.push(
                                    `${indentation}stroke-width: ${strokeWValue};`,
                                );
                            }
                        }
                    }
                    break;
            }
        } catch (err) {
            console.error(
                `[generatePathNodeSnippet] Error processing property "${property}":`,
                err,
            );
            properties.push(
                `${indentation}// Error processing ${property}: ${err instanceof Error ? err.message : err}`,
            );
        }
    }

    await pushChildrenProperties(properties, sceneNode, useVariables);

    return `// ${nodeId}\nPath {\n${properties.join("\n")}\n}`;
}

export async function generateTextSnippet(
    sceneNode: SceneNode,
    useVariables: boolean,
): Promise<string> {
    const properties: string[] = [];
    const nodeId = sanitizePropertyName(sceneNode.name);

    await pushSharedNodeProperties(properties, sceneNode, useVariables);

    for (const property of textProperties) {
        try {
            switch (property) {
                case "text":
                    // Assuming 'characters' binding is also an array if it exists
                    const boundCharsVarId = (sceneNode as any).boundVariables
                        ?.characters?.[0]?.id;
                    let textValue: string | null = null;
                    if (boundCharsVarId && useVariables) {
                        textValue =
                            await getVariablePathString(boundCharsVarId);
                    }
                    if (!textValue && "characters" in sceneNode) {
                        textValue = `"${sceneNode.characters}"`;
                    }
                    if (textValue) {
                        properties.push(`${indentation}text: ${textValue};`);
                    }
                    break;
                case "fills":
                    const fillValue = await getFillValue(sceneNode, useVariables);
                    if (fillValue) {
                        properties.push(`${indentation}color: ${fillValue};`);
                    }
                    break;
                case "font-family":
                    // Keep using resolved family name. Variable structure for FontName is complex.
                    if ("fontName" in sceneNode) {
                        const fontName = sceneNode.fontName;
                        if (typeof fontName !== "symbol" && fontName) {
                            properties.push(
                                `${indentation}font-family: "${fontName.family}";`,
                            );
                        }
                    }
                    break;
                case "font-size":
                    //  Access ID via array index [0]
                    const boundSizeVarId = (sceneNode as any).boundVariables
                        ?.fontSize?.[0]?.id;
                    let sizeValue: string | null = null;
                    if (boundSizeVarId && useVariables) {
                        sizeValue = await getVariablePathString(boundSizeVarId);
                    }
                    if (
                        !sizeValue &&
                        "fontSize" in sceneNode &&
                        typeof sceneNode.fontSize === "number"
                    ) {
                        const fontSize = roundNumber(sceneNode.fontSize);
                        if (fontSize) {
                            sizeValue = `${fontSize}px`;
                        }
                    }
                    if (sizeValue) {
                        properties.push(
                            `${indentation}font-size: ${sizeValue};`,
                        );
                    }
                    break;
                case "font-weight":
                    const boundWeightVarId = (sceneNode as any).boundVariables
                        ?.fontWeight?.[0]?.id; // Still use [0] based on Text node structure
                    let weightValue: string | number | null = null;
                    let isVariable = false; // Flag to track if value is from a variable

                    if (boundWeightVarId && useVariables) {
                        const path =
                            await getVariablePathString(boundWeightVarId);
                        if (path) {
                            weightValue = path;
                            isVariable = true;
                        }
                    }

                    // Fallback if not bound or variable path failed
                    if (
                        weightValue === null &&
                        "fontWeight" in sceneNode &&
                        typeof sceneNode.fontWeight === "number"
                    ) {
                        weightValue = sceneNode.fontWeight;
                    }

                    if (weightValue !== null) {
                        //  Append '/ 1px' if it's a variable path (string)
                        const finalWeightValue = isVariable
                            ? `${weightValue} / 1px`
                            : weightValue;

                        properties.push(
                            `${indentation}font-weight: ${finalWeightValue};`,
                        );
                    }
                    break;
                case "horizontal-alignment":
                    if (
                        "textAlignHorizontal" in sceneNode &&
                        typeof sceneNode.textAlignHorizontal === "string"
                    ) {
                        let slintValue: string | null = null;
                        let comment = "";
                        switch (sceneNode.textAlignHorizontal) {
                            case "LEFT":
                                slintValue = "left";
                                break;
                            case "CENTER":
                                slintValue = "center";
                                break;
                            case "RIGHT":
                                slintValue = "right";
                                break;
                            case "JUSTIFIED":
                                slintValue = "left";
                                comment =
                                    "// Note: The value was justified in Figma, but this isn't supported right now";
                                break;
                        }
                        if (slintValue) {
                            properties.push(
                                `${indentation}horizontal-alignment: ${slintValue}; ${comment}`,
                            );
                        }
                    }
                    break;
            }
        } catch (err) {
            console.error(
                `[generateTextSnippet] Error processing property "${property}":`,
                err,
            );
            properties.push(
                `${indentation}// Error processing ${property}: ${err instanceof Error ? err.message : err}`,
            );
        }
    }

    await pushChildrenProperties(properties, sceneNode, useVariables);

    return `// ${nodeId}\nText {\n${properties.join("\n")}\n}`;
}
