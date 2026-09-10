"""
Unit normalization, algebra, and display helpers for Qimchi plots.

Plot data always remains in the units recorded by the instrument.  This module
only describes those units and produces display strings.

"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from html import unescape
from typing import Any, Mapping

UNIT_META_KEY = "qimchi_units"
COLORBAR_TITLE_ANNOTATION_NAME = "qimchi-colorbar-title"
COLORBAR_TITLE_FONT_SIZE = 16
COLORBAR_TITLE_MATH_FONT_SIZE = 20
COLORBAR_TITLE_MIN_FONT_SIZE = 12
# The colorbar title lives in the figure's right margin. Cap how much of the
# plot a long one may claim, and shrink the type once it hits that cap.
COLORBAR_GUTTER_MIN_PX = 110
COLORBAR_GUTTER_MAX_PX = 180
# Covers the annotation's 0.02-paper offset from the plot's right edge.
COLORBAR_GUTTER_PADDING_PX = 16
# Mean glyph advance for Fira Sans, in em. Deliberately below the nominal
# ~0.55: MathJax sets a fraction's terms smaller than the surrounding type,
# and _plain_latex_length counts the longer term at full size.
_COLORBAR_GLYPH_EM = 0.45
TITLE_TEMPLATE_KEY = "title_template"

_PREFIXES: tuple[tuple[str, int], ...] = (
    ("Y", 24),
    ("Z", 21),
    ("E", 18),
    ("P", 15),
    ("T", 12),
    ("G", 9),
    ("M", 6),
    ("k", 3),
    ("", 0),
    ("m", -3),
    ("µ", -6),
    ("n", -9),
    ("p", -12),
    ("f", -15),
    ("a", -18),
    ("z", -21),
    ("y", -24),
)
_PREFIX_TO_EXPONENT = dict(_PREFIXES)
_EXPONENT_TO_PREFIX = {exponent: prefix for prefix, exponent in _PREFIXES}

_UNIT_ALIASES = {
    "": "",
    "1": "",
    "a.u.": "a.u.",
    "a.u": "a.u.",
    "arb": "a.u.",
    "arb.": "a.u.",
    "arbitraryunits": "a.u.",
    "ohm": "Ω",
    "ohms": "Ω",
    "Ohm": "Ω",
    "Ohms": "Ω",
    "Ω": "Ω",
    "volt": "V",
    "volts": "V",
    "amp": "A",
    "amps": "A",
    "ampere": "A",
    "amperes": "A",
    "siemens": "S",
    "second": "s",
    "seconds": "s",
    "u": "µ",
}

# Derived units are expanded for algebra and collapsed again for display.  New
# identities belong here rather than in plotting or filter code.
_UNIT_FACTORS: dict[str, dict[str, int]] = {
    "Ω": {"V": 1, "A": -1},
    "S": {"A": 1, "V": -1},
    "Hz": {"s": -1},
    "W": {"V": 1, "A": 1},
}
_DERIVED_FACTORS: tuple[tuple[dict[str, int], str], ...] = (
    ({"V": 1, "A": -1}, "Ω"),
    ({"A": 1, "V": -1}, "S"),
    ({"s": -1}, "Hz"),
    ({"V": 1, "A": 1}, "W"),
)

_KNOWN_BASE_UNITS = {
    "A",
    "C",
    "F",
    "H",
    "J",
    "K",
    "Pa",
    "T",
    "V",
    "Wb",
    "cd",
    "g",
    "m",
    "mol",
    "rad",
    "s",
}
_SUPERSCRIPT_TO_ASCII = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹⁻", "0123456789-")
_ASCII_TO_SUPERSCRIPT = str.maketrans("0123456789-", "⁰¹²³⁴⁵⁶⁷⁸⁹⁻")

_ELEMENTARY_CHARGE = 1.602176634e-19
_PLANCK_CONSTANT = 6.62607015e-34
SCALE_QUANTITIES: dict[str, dict[str, float | str]] = {
    "g0": {
        "value": _ELEMENTARY_CHARGE**2 / _PLANCK_CONSTANT,
        "unit": "S",
        "expression": "e^2 / h (G_0)",
        "latex_expression": r"\frac{e^{2}}{h}\;(G_{0})",
    },
    "2g0": {
        "value": 2 * _ELEMENTARY_CHARGE**2 / _PLANCK_CONSTANT,
        "unit": "S",
        "expression": "2e^2 / h (2G_0)",
        "latex_expression": r"\frac{2e^{2}}{h}\;(2G_{0})",
    },
    "r0": {
        "value": _PLANCK_CONSTANT / _ELEMENTARY_CHARGE**2,
        "unit": "Ω",
        "expression": "h / e^2 (R_0)",
        "latex_expression": r"\frac{h}{e^{2}}\;(R_{0})",
    },
}


@dataclass(frozen=True)
class Unit:
    """
    A scale and symbolic unit-factor expression.

    ``scale`` converts one unit of the expression to its unprefixed canonical
    form.  For example, ``mV`` is ``Unit({"V": 1}, 1e-3)``.

    """

    factors: tuple[tuple[str, int], ...] = ()
    scale: float = 1.0
    opaque: str | None = None

    @classmethod
    def from_parts(
        cls,
        factors: Mapping[str, int] | None = None,
        scale: float = 1.0,
        opaque: str | None = None,
    ) -> Unit:
        normalized = tuple(
            sorted(
                (symbol, power) for symbol, power in (factors or {}).items() if power
            )
        )
        return cls(normalized, scale, opaque)

    @property
    def factor_map(self) -> dict[str, int]:
        return dict(self.factors)

    @property
    def is_dimensionless(self) -> bool:
        return not self.factors and not self.opaque

    def multiply(self, other: Unit) -> Unit:
        if self.opaque or other.opaque:
            return Unit(opaque=_join_opaque(self, other, "·"))
        factors = self.factor_map
        for symbol, power in other.factors:
            factors[symbol] = factors.get(symbol, 0) + power
        return Unit.from_parts(factors, self.scale * other.scale)

    def divide(self, other: Unit) -> Unit:
        if self.opaque or other.opaque:
            return Unit(opaque=_join_opaque(self, other, "/"))
        factors = self.factor_map
        for symbol, power in other.factors:
            factors[symbol] = factors.get(symbol, 0) - power
        return Unit.from_parts(factors, self.scale / other.scale)

    def power(self, exponent: int) -> Unit:
        if self.opaque:
            return Unit(opaque=f"({self.opaque})^{exponent}")
        return Unit.from_parts(
            {symbol: power * exponent for symbol, power in self.factors},
            self.scale**exponent,
        )


def _join_opaque(left: Unit, right: Unit, operator: str) -> str:
    return f"{render_unit(left)} {operator} {render_unit(right)}".strip()


def sanitize_label(value: Any, fallback: str = "") -> str:
    """Return a safe, compact plain-text instrument label."""
    text = unescape(str(value or ""))
    text = re.sub(r"<[^>]*>", "", text)
    text = " ".join(text.split()).strip()
    return text or fallback


def _normalize_unit_text(value: Any) -> str:
    text = unescape(str(value or "")).strip()
    text = text.replace("μ", "µ").replace("Ω", "Ω")
    text = text.replace("⋅", "·").replace("×", "·")
    text = re.sub(r"\s+", "", text)
    return _UNIT_ALIASES.get(text, text)


def _split_prefixed_symbol(token: str) -> tuple[str, int] | None:
    token = _UNIT_ALIASES.get(token, token)
    if token in _UNIT_FACTORS or token in _KNOWN_BASE_UNITS:
        return token, 0
    for prefix, exponent in (*_PREFIXES, ("u", -6)):
        if not prefix or not token.startswith(prefix):
            continue
        symbol = _UNIT_ALIASES.get(token[len(prefix) :], token[len(prefix) :])
        if symbol in _UNIT_FACTORS or symbol in _KNOWN_BASE_UNITS:
            return symbol, exponent
    return None


def _parse_factor(token: str) -> tuple[str, int, int] | None:
    if not token:
        return None
    token = token.strip("()")
    exponent = 1
    match = re.fullmatch(r"(.+?)\^\(?(-?\d+)\)?", token)
    if match:
        token, exponent_text = match.groups()
        exponent = int(exponent_text)
    else:
        match = re.fullmatch(r"(.+?)([⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+)", token)
        if match:
            token, exponent_text = match.groups()
            exponent = int(exponent_text.translate(_SUPERSCRIPT_TO_ASCII))
    parsed = _split_prefixed_symbol(token)
    if parsed is None:
        return None
    symbol, prefix_exponent = parsed
    return symbol, exponent, prefix_exponent * exponent


def parse_unit(value: Any) -> Unit:
    """Parse common SI expressions while preserving unknown domain units."""
    text = _normalize_unit_text(value)
    if not text:
        return Unit()
    if text == "a.u.":
        return Unit(opaque=text)

    parts = re.split(r"([/·*])", text)
    factors: dict[str, int] = {}
    scale_exponent = 0
    sign = 1
    for part in parts:
        if not part:
            continue
        if part in ("·", "*"):
            continue
        if part == "/":
            sign = -1
            continue
        if part == "1":
            continue
        parsed = _parse_factor(part)
        if parsed is None:
            return Unit(opaque=text)
        symbol, power, prefix_power = parsed
        expanded = _UNIT_FACTORS.get(symbol, {symbol: 1})
        for base_symbol, base_power in expanded.items():
            factors[base_symbol] = (
                factors.get(base_symbol, 0) + sign * power * base_power
            )
        scale_exponent += sign * prefix_power
    return Unit.from_parts(factors, 10.0**scale_exponent)


def _power_text(power: int, *, latex: bool) -> str:
    if power == 1:
        return ""
    return f"^{{{power}}}" if latex else str(power).translate(_ASCII_TO_SUPERSCRIPT)


def _canonical_symbol(factors: Mapping[str, int]) -> str | None:
    compact = {symbol: power for symbol, power in factors.items() if power}
    for derived_factors, symbol in _DERIVED_FACTORS:
        if compact == derived_factors:
            return symbol
    if len(compact) == 1:
        symbol, power = next(iter(compact.items()))
        if power == 1:
            return symbol
    return None


def _factor_derived_units(factors: Mapping[str, int]) -> dict[str, int]:
    """Greedily expose derived units inside larger compound expressions."""
    remaining = {symbol: power for symbol, power in factors.items() if power}
    rendered: dict[str, int] = {}
    for identity, symbol in _DERIVED_FACTORS:
        while all(
            remaining.get(base, 0) >= power
            if power > 0
            else remaining.get(base, 0) <= power
            for base, power in identity.items()
        ):
            for base, power in identity.items():
                remaining[base] = remaining.get(base, 0) - power
                if remaining[base] == 0:
                    del remaining[base]
            rendered[symbol] = rendered.get(symbol, 0) + 1
    for symbol, power in remaining.items():
        rendered[symbol] = rendered.get(symbol, 0) + power
    return rendered


def _format_symbol(symbol: str, *, latex: bool) -> str:
    if not latex:
        return symbol

    prefix = ""
    base = symbol
    if len(symbol) > 1 and symbol[0] in _PREFIX_TO_EXPONENT:
        prefix, base = symbol[0], symbol[1:]

    if base == "Ω":
        prefix_text = (
            r"\mu" if prefix == "µ" else rf"\mathrm{{{prefix}}}" if prefix else ""
        )
        return prefix_text + r"\Omega"
    if prefix == "µ":
        return rf"\mu\mathrm{{{base}}}"
    return rf"\mathrm{{{prefix}{base}}}"


def _engineering_exponent(scale: float) -> int | None:
    if not math.isfinite(scale) or scale <= 0:
        return None
    exponent = round(math.log10(scale))
    if not math.isclose(scale, 10.0**exponent, rel_tol=1e-12):
        return None
    return exponent if exponent in _EXPONENT_TO_PREFIX else None


def _format_factors(
    factors: Mapping[str, int], *, prefix_exponent: int = 0, latex: bool = False
) -> str:
    canonical = _canonical_symbol(factors)
    prefix = _EXPONENT_TO_PREFIX.get(prefix_exponent)
    if canonical and prefix is not None:
        symbol = f"{prefix}{canonical}"
        return _format_symbol(symbol, latex=latex)

    factors = _factor_derived_units(factors)

    numerator = [(symbol, power) for symbol, power in factors.items() if power > 0]
    denominator = [(symbol, -power) for symbol, power in factors.items() if power < 0]
    numerator.sort()
    denominator.sort()
    # A prefix only carries the intended factor of 10 on a first-power symbol:
    # "kV²" would scale by 10⁶, not 10³. Where it cannot, the unit is rendered
    # unprefixed and _axis_unit_layout_definition drops that exponent, so ticks
    # are never rescaled against a title that does not say so.
    if prefix_exponent and prefix is not None:
        if numerator and numerator[0][1] == 1:
            numerator[0] = (f"{prefix}{numerator[0][0]}", 1)
        elif not numerator and denominator and denominator[0][1] == 1:
            # 1/V displayed at 10³ means "per mV": the prefix inverts.
            inverse_prefix = _EXPONENT_TO_PREFIX.get(-prefix_exponent)
            if inverse_prefix is not None:
                denominator[0] = (f"{inverse_prefix}{denominator[0][0]}", 1)

    def join(items: list[tuple[str, int]]) -> str:
        separator = r"\," if latex else "·"
        rendered = separator.join(
            f"{_format_symbol(symbol, latex=latex)}{_power_text(power, latex=latex)}"
            for symbol, power in items
        )
        return rendered

    top = join(numerator) or ("1" if denominator else "")
    bottom = join(denominator)
    if not bottom:
        return top
    return f"\\frac{{{top}}}{{{bottom}}}" if latex else f"{top}/{bottom}"


def render_unit(unit: Unit | str | None, *, latex: bool = False) -> str:
    parsed = parse_unit(unit) if not isinstance(unit, Unit) else unit
    if parsed.opaque:
        return f"\\mathrm{{{parsed.opaque}}}" if latex else parsed.opaque
    if parsed.is_dimensionless:
        return ""
    exponent = _engineering_exponent(parsed.scale)
    if exponent is not None:
        return _format_factors(parsed.factor_map, prefix_exponent=exponent, latex=latex)
    base = _format_factors(parsed.factor_map, latex=latex)
    scale_text = f"{parsed.scale:g}"
    return f"{scale_text}\\,{base}" if latex else f"{scale_text} {base}"


def sanitize_unit(value: Any) -> str:
    return render_unit(parse_unit(value))


def multiply_units(left: Unit | str | None, right: Unit | str | None) -> Unit:
    return (parse_unit(left) if not isinstance(left, Unit) else left).multiply(
        parse_unit(right) if not isinstance(right, Unit) else right
    )


def divide_units(numerator: Unit | str | None, denominator: Unit | str | None) -> Unit:
    return (
        parse_unit(numerator) if not isinstance(numerator, Unit) else numerator
    ).divide(
        parse_unit(denominator) if not isinstance(denominator, Unit) else denominator
    )


def inverse_unit(unit: Unit | str | None) -> Unit:
    return (parse_unit(unit) if not isinstance(unit, Unit) else unit).power(-1)


def coefficient_unit(y_unit: str | None, x_unit: str | None, power: int) -> Unit:
    return divide_units(y_unit, parse_unit(x_unit).power(power))


def _nearest_prefix_exponent(value_in_base_units: float) -> int:
    if not value_in_base_units or not math.isfinite(value_in_base_units):
        return 0
    magnitude = math.log10(abs(value_in_base_units))
    nearest_integer = round(magnitude)
    if math.isclose(magnitude, nearest_integer, abs_tol=1e-12):
        magnitude = float(nearest_integer)
    exponent = 3 * math.floor(magnitude / 3)
    return min(24, max(-24, exponent))


def _format_mantissa(value: float) -> str:
    # Prefix selection is the policy.  ``g`` merely avoids binary-float noise;
    # it is deliberately not a fixed significant-digit or decimal-place rule.
    return f"{value:.8g}"


def format_quantity(
    value: float,
    unit: Unit | str | None,
    *,
    latex: bool = False,
) -> str:
    """Move a scalar to its nearest engineering prefix for presentation."""
    parsed = parse_unit(unit) if not isinstance(unit, Unit) else unit
    if parsed.opaque:
        separator = r"\," if latex else " "
        return f"{_format_mantissa(value)}{separator}{render_unit(parsed, latex=latex)}"
    value_in_base_units = value * parsed.scale
    prefix_exponent = _nearest_prefix_exponent(value_in_base_units)
    displayed_value = value_in_base_units / (10.0**prefix_exponent)
    unit_text = _format_factors(
        parsed.factor_map, prefix_exponent=prefix_exponent, latex=latex
    )
    if not unit_text:
        return _format_mantissa(displayed_value)
    separator = r"\," if latex else " "
    return f"{_format_mantissa(displayed_value)}{separator}{unit_text}"


def axis_definition(
    label: Any, unit: Any = "", *, fallback: str = ""
) -> dict[str, str]:
    return {
        "label": sanitize_label(label, fallback),
        "unit": sanitize_unit(unit),
    }


def resolve_axis_definition(
    data: Any, metadata: Mapping[str, Any], variable: str
) -> dict[str, str]:
    """Resolve label/unit independently, preferring instrument-backed attrs."""
    attrs: Mapping[str, Any] = {}
    try:
        attrs = data[variable].attrs
    except (KeyError, TypeError, AttributeError):
        pass
    meta = metadata.get(variable, {}) if isinstance(metadata, Mapping) else {}
    if not isinstance(meta, Mapping):
        meta = {}
    label = (
        attrs.get("label") or attrs.get("long_name") or meta.get("label") or variable
    )
    unit = (
        attrs.get("unit")
        or attrs.get("units")
        or meta.get("unit")
        or meta.get("units")
        or ""
    )
    return axis_definition(label, unit, fallback=variable)


def scale_quantity_label_suffix(expression: Any) -> str:
    """Return the plain-text label suffix marking a quantity-scaled axis.

    The filter divides by the constant, but the axis reads as a multiple of
    it -- a value of 3 on a "[x G_0]" axis *is* 3 G0 -- so the suffix is
    written as a multiplication.

    """
    return f" [x {expression}]"


def _split_scale_suffix(label: Any) -> tuple[str, str]:
    clean_label = sanitize_label(label, "")
    for quantity in SCALE_QUANTITIES.values():
        expression = str(quantity["expression"])
        latex_expression = quantity["latex_expression"]
        # "[/ ...]" was the wording during 0.7.0 development only.
        for suffix in (
            scale_quantity_label_suffix(expression),
            f" [/ {expression}]",
        ):
            if clean_label.endswith(suffix):
                return (
                    clean_label[: -len(suffix)],
                    rf"\;\left[\times {latex_expression}\right]",
                )
    return clean_label, ""


def _axis_title_with_rendered_unit(label: Any, latex_unit: str) -> str:
    clean_label, suffix_latex = _split_scale_suffix(label)

    latex_label = latex_text(clean_label).replace(" ", r"\ ")
    if not latex_unit and not suffix_latex:
        return clean_label
    unit_suffix = rf"\;\left({latex_unit}\right)" if latex_unit else ""
    return rf"$\mathrm{{{latex_label}}}{suffix_latex}{unit_suffix}$"


def axis_title(definition: Mapping[str, Any]) -> str:
    return _axis_title_with_rendered_unit(
        definition.get("label"),
        render_unit(definition.get("unit"), latex=True),
    )


def plain_axis_title(definition: Mapping[str, Any]) -> str:
    """Return an unformatted "Label (unit)" title.

    Plotly renders hover text as HTML, not MathJax, so a TeX axis title shows
    up there as its own source. Hover boxes use this instead.

    """
    normalized = axis_definition(definition.get("label"), definition.get("unit"))
    unit = render_unit(normalized["unit"])
    return f"{normalized['label']} ({unit})" if unit else normalized["label"]


def _axis_unit_layout_definition(definition: Mapping[str, Any]) -> dict[str, Any]:
    """Add display-only engineering scales generated by the unit engine."""
    normalized = axis_definition(definition.get("label"), definition.get("unit"))
    parsed = parse_unit(normalized["unit"])
    enriched: dict[str, Any] = dict(normalized)
    enriched["engineering_scale"] = parsed.scale

    if parsed.opaque or parsed.is_dimensionless:
        enriched["engineering_units"] = {}
        enriched["engineering_titles"] = {}
        return enriched

    unprefixed = _format_factors(parsed.factor_map, latex=True)
    units: dict[str, str] = {}
    titles: dict[str, str] = {}
    for _prefix, exponent in _PREFIXES:
        latex_unit = _format_factors(
            parsed.factor_map,
            prefix_exponent=exponent,
            latex=True,
        )
        # A unit that cannot carry this prefix (V², say) renders unchanged.
        # Offering it would let the frontend divide the ticks by 10^exponent
        # under a title still reading the unprefixed unit.
        if exponent and latex_unit == unprefixed:
            continue
        units[str(exponent)] = latex_unit
        titles[str(exponent)] = _axis_title_with_rendered_unit(
            normalized["label"],
            latex_unit,
        )
    enriched["engineering_units"] = units
    enriched["engineering_titles"] = titles
    return enriched


def derivative_axis_title(
    numerator_label: Any,
    denominator_label: Any,
    unit: Unit | str | None,
    *,
    result_label: Any = "",
    compact: bool = False,
    compact_denominator: str = "x",
) -> str:
    """Render a derivative title for a full-sized Cartesian axis."""
    return _derivative_title_with_rendered_unit(
        numerator_label,
        denominator_label,
        render_unit(unit, latex=True),
        result_label=result_label,
        compact=compact,
        compact_denominator=compact_denominator,
    )


def _derivative_title_with_rendered_unit(
    numerator_label: Any,
    denominator_label: Any,
    latex_unit: str,
    *,
    result_label: Any = "",
    compact: bool = False,
    compact_denominator: str = "x",
) -> str:
    if compact:
        denominator_symbol = "y" if compact_denominator == "y" else "x"
        numerator_term = r"\mathrm{d}z"
        denominator_term = rf"\mathrm{{d}}{denominator_symbol}"
    else:
        numerator = latex_text(numerator_label).replace(" ", r"\ ")
        denominator = latex_text(denominator_label).replace(" ", r"\ ")
        numerator_term = rf"\mathrm{{d}}\,\mathrm{{{numerator}}}"
        denominator_term = rf"\mathrm{{d}}\,\mathrm{{{denominator}}}"
    _, scale_suffix = _split_scale_suffix(result_label)
    unit_suffix = rf"\;\left({latex_unit}\right)" if latex_unit else ""
    return (
        rf"$\frac{{{numerator_term}}}{{{denominator_term}}}"
        rf"{scale_suffix}{unit_suffix}$"
    )


def colorbar_title_font_size(text: Any) -> int:
    """Size the colorbar title to its content and to the gutter it must fit.

    MathJax draws a fraction's numerator and denominator well below the
    requested size, so a derivative title starts larger. Only the leading term
    counts: a fraction that merely appears inside a scale suffix --
    "[x 2e^2/h (2G_0)]" -- leaves the label itself full-sized, and enlarging
    that overshoots.

    A long title is then stepped back down far enough to fit the widest gutter
    worth spending on it, so that it is never clipped and the plot never loses
    more than that gutter.

    """
    body = sanitize_label(text, "").lstrip("$")
    base = (
        COLORBAR_TITLE_MATH_FONT_SIZE
        if body.startswith(r"\frac")
        else COLORBAR_TITLE_FONT_SIZE
    )
    length = _plain_latex_length(text)
    if length <= 0:
        return base
    budget = COLORBAR_GUTTER_MAX_PX - COLORBAR_GUTTER_PADDING_PX
    fitted = int(budget / ((length + 1) * _COLORBAR_GLYPH_EM))
    return max(COLORBAR_TITLE_MIN_FONT_SIZE, min(base, fitted))


def _plain_latex_length(text: Any) -> int:
    """Approximate how many glyphs a TeX title renders as.

    Only rough sizing is needed -- enough to reserve a gutter -- so control
    sequences collapse to what they draw and a fraction counts as its longer
    term, since numerator and denominator stack.

    """
    body = sanitize_label(text, "").strip("$")
    # Innermost fractions first, so nested ones collapse from the inside out.
    fraction = re.compile(r"\\frac\{([^{}]*)\}\{([^{}]*)\}")
    for _ in range(8):
        body, replaced = fraction.subn(
            lambda match: max(match.group(1), match.group(2), key=len), body
        )
        if not replaced:
            break
    body = re.sub(r"\\(?:mathrm|left|right|displaystyle)\b", "", body)
    body = re.sub(r"\\[;,!:> ]", " ", body)
    # Any remaining control sequence draws roughly one glyph (\times, \Omega).
    body = re.sub(r"\\[A-Za-z]+", "x", body)
    body = re.sub(r"[{}^_]", "", body)
    return len(body.strip())


def colorbar_gutter_px(title: Any, font_size: int | None = None) -> int:
    """Return a right margin wide enough for the colorbar and its title.

    The title sits in the figure's right margin, so a long one -- a derivative
    with a scale suffix and a unit -- is clipped on screen and in exports
    alike unless the margin grows with it. The estimate covers every
    engineering prefix of the same title, so switching prefixes never re-flows
    the plot.

    """
    size = font_size if font_size is not None else colorbar_title_font_size(title)
    # A glyph of slack covers the engineering prefix the frontend may add.
    estimate = (_plain_latex_length(title) + 1) * _COLORBAR_GLYPH_EM * size
    return int(
        min(
            COLORBAR_GUTTER_MAX_PX,
            max(COLORBAR_GUTTER_MIN_PX, estimate + COLORBAR_GUTTER_PADDING_PX),
        )
    )


def colorbar_title_annotation(text: str) -> dict[str, Any]:
    """Return the horizontal, MathJax-safe title used above heatmap colorbars."""
    return {
        "name": COLORBAR_TITLE_ANNOTATION_NAME,
        "text": text,
        "xref": "paper",
        "yref": "paper",
        "x": 1.02,
        "y": 0.88,
        "xanchor": "left",
        "yanchor": "bottom",
        "align": "left",
        "textangle": 0,
        "showarrow": False,
        "font": {"size": colorbar_title_font_size(text)},
    }


def set_figure_colorbar_title(figure: Any, title: str) -> None:
    """Set a heatmap title without Plotly's rotated-MathJax colorbar bug."""
    annotations = [
        annotation.to_plotly_json()
        if hasattr(annotation, "to_plotly_json")
        else dict(annotation)
        for annotation in (figure.layout.annotations or [])
    ]
    for index, annotation in enumerate(annotations):
        if annotation.get("name") == COLORBAR_TITLE_ANNOTATION_NAME:
            font = {**(annotation.get("font") or {})}
            font["size"] = colorbar_title_font_size(title)
            annotations[index] = {**annotation, "text": title, "font": font}
            break
    else:
        annotations.append(colorbar_title_annotation(title))
    figure.update_layout(
        annotations=annotations,
        coloraxis={"colorbar": {"title": {"text": ""}}},
        # A filter can lengthen the title; widen the gutter so it still fits.
        margin={"r": colorbar_gutter_px(title)},
    )


def unit_layout_meta(**axes: Mapping[str, Any]) -> dict[str, Any]:
    return {
        UNIT_META_KEY: {
            name: _axis_unit_layout_definition(value) for name, value in axes.items()
        }
    }


def axis_definition_from_figure(figure: Mapping[str, Any], axis: str) -> dict[str, str]:
    layout = figure.get("layout", {})
    meta = layout.get("meta", {}) if isinstance(layout, Mapping) else {}
    definitions = meta.get(UNIT_META_KEY, {}) if isinstance(meta, Mapping) else {}
    definition = definitions.get(axis) if isinstance(definitions, Mapping) else None
    if isinstance(definition, Mapping):
        return axis_definition(definition.get("label"), definition.get("unit"))

    if axis == "z":
        title = (
            layout.get("coloraxis", {})
            .get("colorbar", {})
            .get("title", {})
            .get("text", "")
        )
    else:
        title_obj = layout.get(f"{axis}axis", {}).get("title", {})
        title = (
            title_obj.get("text", "") if isinstance(title_obj, Mapping) else title_obj
        )
    match = re.fullmatch(r"\s*(.*?)\s*\(([^()]*)\)\s*", str(title or ""))
    if match:
        return axis_definition(match.group(1), match.group(2))
    return axis_definition(title or axis.upper(), "")


def axis_title_template_from_figure(figure: Any, axis: str) -> dict[str, Any] | None:
    """Return structured title metadata retained by an earlier filter."""
    if isinstance(figure, Mapping):
        layout = figure.get("layout", {})
        meta = layout.get("meta", {}) if isinstance(layout, Mapping) else {}
    else:
        meta = dict(getattr(getattr(figure, "layout", None), "meta", None) or {})
    definitions = meta.get(UNIT_META_KEY, {}) if isinstance(meta, Mapping) else {}
    definition = definitions.get(axis) if isinstance(definitions, Mapping) else None
    template = (
        definition.get(TITLE_TEMPLATE_KEY) if isinstance(definition, Mapping) else None
    )
    return dict(template) if isinstance(template, Mapping) else None


def set_figure_axis_definition(
    figure: Any,
    axis: str,
    definition: Mapping[str, Any],
    *,
    update_title: bool = True,
) -> None:
    """Update semantic axis metadata and, by default, its displayed title."""
    normalized = axis_definition(definition.get("label"), definition.get("unit"))
    current_meta = dict(figure.layout.meta or {})
    definitions = dict(current_meta.get(UNIT_META_KEY, {}))
    enriched = _axis_unit_layout_definition(normalized)
    existing = definitions.get(axis)
    if not update_title and isinstance(existing, Mapping):
        existing_normalized = axis_definition(
            existing.get("label"), existing.get("unit")
        )
        if existing_normalized == normalized:
            for key in (TITLE_TEMPLATE_KEY, "engineering_titles"):
                if key in existing:
                    enriched[key] = existing[key]
    definitions[axis] = enriched
    current_meta[UNIT_META_KEY] = definitions
    figure.update_layout(meta=current_meta)
    if not update_title:
        return
    title = axis_title(normalized)
    if axis == "z":
        set_figure_colorbar_title(figure, title)
    else:
        figure.update_layout(**{f"{axis}axis": {"title": {"text": title}}})


def set_figure_derivative_axis_definition(
    figure: Any,
    axis: str,
    numerator_label: Any,
    denominator_label: Any,
    definition: Mapping[str, Any],
    *,
    compact: bool = False,
    compact_denominator: str = "x",
) -> None:
    """Set derivative metadata without losing its TeX form during SI scaling."""
    normalized = axis_definition(definition.get("label"), definition.get("unit"))
    enriched = _axis_unit_layout_definition(normalized)
    enriched[TITLE_TEMPLATE_KEY] = {
        "kind": "derivative",
        "numerator_label": sanitize_label(numerator_label, "Y"),
        "denominator_label": sanitize_label(denominator_label, "X"),
        "compact": compact,
        "compact_denominator": compact_denominator,
    }
    enriched["engineering_titles"] = {
        exponent: _derivative_title_with_rendered_unit(
            numerator_label,
            denominator_label,
            latex_unit,
            result_label=normalized["label"],
            compact=compact,
            compact_denominator=compact_denominator,
        )
        for exponent, latex_unit in enriched["engineering_units"].items()
    }

    current_meta = dict(figure.layout.meta or {})
    definitions = dict(current_meta.get(UNIT_META_KEY, {}))
    definitions[axis] = enriched
    current_meta[UNIT_META_KEY] = definitions
    figure.update_layout(meta=current_meta)

    title = derivative_axis_title(
        numerator_label,
        denominator_label,
        normalized["unit"],
        result_label=normalized["label"],
        compact=compact,
        compact_denominator=compact_denominator,
    )
    if axis == "z":
        set_figure_colorbar_title(figure, title)
    else:
        figure.update_layout(**{f"{axis}axis": {"title": {"text": title}}})


def latex_text(value: Any) -> str:
    """Escape ordinary text for use inside ``\\mathrm{...}``."""
    text = sanitize_label(value)
    replacements = {
        "\\": r"\backslash ",
        "_": r"\_",
        "%": r"\%",
        "&": r"\&",
        "#": r"\#",
        "{": r"\{",
        "}": r"\}",
    }
    return "".join(replacements.get(char, char) for char in text)
