from flask import Flask, request
import json
from latex2sympy2_extended import latex2sympy
import sympy
from sympy import latex, simplify, factor, expand, apart, expand_trig, solve

app = Flask(__name__)

class SessionState:
    """Manages session state for variable storage and settings"""
    def __init__(self):
        self.variables = {}  # Stores user-defined variables
        self.is_real = False  # Complex number support toggle

session_state = SessionState()


def latex2latex_impl(latex_str: str, variables: dict, is_real: bool = False) -> str:
    """
    Replacement for the missing latex2latex() function.
    Converts LaTeX to SymPy, evaluates with current variables, and converts back to LaTeX.
    """
    try:
        # Parse the LaTeX expression
        expr = latex2sympy(latex_str, variable_values=variables, is_real=is_real)

        # Handle assignments (e.g., "y = x + 1")
        if isinstance(expr, sympy.Equality):
            var_name = str(expr.lhs)
            variables[var_name] = expr.rhs
            # Return the full equation
            return latex(expr)

        # Handle equations that need solving (e.g., "x + y = 5")
        # This would already be parsed as Equality above

        # Regular expression evaluation with variable substitution
        result = expr.subs(variables).doit()
        return latex(result)

    except Exception as e:
        raise Exception(f"LaTeX parsing error: {str(e)}")


@app.route('/')
def main():
    return 'Latex Sympy Calculator Server'


@app.route('/latex', methods=['POST'])
def get_latex():
    try:
        result = latex2latex_impl(
            request.json['data'],
            session_state.variables,
            session_state.is_real
        )
        return {'data': result, 'error': ''}
    except Exception as e:
        return {'data': '', 'error': str(e)}


@app.route('/matrix-raw-echelon-form', methods=['POST'])
def get_matrix_raw_echelon_form():
    try:
        expr = latex2sympy(
            request.json['data'],
            variable_values=session_state.variables,
            is_real=session_state.is_real
        )

        # Substitute variables and compute RREF
        matrix = expr.subs(session_state.variables)

        if not hasattr(matrix, 'rref'):
            return {'data': '', 'error': 'Error: Input is not a matrix'}

        rref_result = matrix.rref()[0]
        return {'data': latex(rref_result), 'error': ''}

    except AttributeError:
        return {'data': '', 'error': 'Error: Input is not a matrix. Please select a matrix expression.'}
    except Exception as e:
        return {'data': '', 'error': f"Matrix calculation error: {str(e)}"}


@app.route('/numerical', methods=['POST'])
def get_numerical():
    try:
        expr = latex2sympy(
            request.json['data'],
            variable_values=session_state.variables,
            is_real=session_state.is_real
        )

        # Substitute variables and evaluate numerically
        result = simplify(expr.subs(session_state.variables).doit().doit()).evalf(
            subs=session_state.variables
        )

        return {'data': latex(result), 'error': ''}

    except Exception as e:
        return {'data': '', 'error': f"Numerical evaluation error: {str(e)}"}


@app.route('/factor', methods=['POST'])
def get_factor():
    try:
        expr = latex2sympy(
            request.json['data'],
            variable_values=session_state.variables,
            is_real=session_state.is_real
        )

        result = factor(expr.subs(session_state.variables))
        return {'data': latex(result), 'error': ''}

    except Exception as e:
        return {'data': '', 'error': f"Factorization error: {str(e)}"}


@app.route('/expand', methods=['POST'])
def get_expand():
    try:
        expr = latex2sympy(
            request.json['data'],
            variable_values=session_state.variables,
            is_real=session_state.is_real
        )

        # Try with apart first
        try:
            result = expand(apart(expand_trig(expr.subs(session_state.variables))))
            return {'data': latex(result), 'error': ''}
        except:
            # Fallback without apart
            result = expand(expand_trig(expr.subs(session_state.variables)))
            return {'data': latex(result), 'error': ''}

    except Exception as e:
        return {'data': '', 'error': f"Expansion error: {str(e)}"}


@app.route('/variances', methods=['GET'])
def get_variances():
    """Get all currently defined variables"""
    result = {key: str(val) for key, val in session_state.variables.items()}
    return json.dumps(result)


@app.route('/reset', methods=['GET'])
def reset():
    """Clear all variables"""
    session_state.variables = {}
    return {'success': True}


@app.route('/complex', methods=['GET'])
def complex():
    """Toggle complex number support"""
    session_state.is_real = not session_state.is_real
    return {'success': True, 'value': session_state.is_real}


@app.route('/python', methods=['POST'])
def run_python():
    """
    Execute Python expressions with restricted namespace for security.
    Only allows safe SymPy operations.
    """
    try:
        code = request.json['data']

        # Security: Block dangerous patterns
        blocked_patterns = [
            'import', 'exec', 'eval', '__', 'open', 'file',
            'compile', 'globals', 'locals', 'vars', 'dir',
            'getattr', 'setattr', 'delattr', 'input'
        ]

        code_lower = code.lower()
        for pattern in blocked_patterns:
            if pattern in code_lower:
                return {
                    'data': '',
                    'error': f'Security error: "{pattern}" is not allowed in Python expressions'
                }

        # Create symbols from variable names
        symbol_dict = {}
        for var_name, var_value in session_state.variables.items():
            symbol_dict[var_name] = sympy.Symbol(var_name)

        # Create safe namespace with allowed functions
        safe_namespace = {
            'var': session_state.variables,
            'variances': session_state.variables,  # Alias for backward compatibility
            'solve': solve,
            'latex': latex,
            'latex2sympy': latex2sympy,
            'simplify': simplify,
            'factor': factor,
            'expand': expand,
            'Matrix': sympy.Matrix,
            'Symbol': sympy.Symbol,
            'symbols': sympy.symbols,
            'sin': sympy.sin,
            'cos': sympy.cos,
            'tan': sympy.tan,
            'exp': sympy.exp,
            'log': sympy.log,
            'sqrt': sympy.sqrt,
            'pi': sympy.pi,
            'E': sympy.E,
            'I': sympy.I,
            'oo': sympy.oo,
            'diff': sympy.diff,
            'integrate': sympy.integrate,
            'limit': sympy.limit,
            'x': sympy.Symbol('x'),
            'y': sympy.Symbol('y'),
            'z': sympy.Symbol('z'),
            **symbol_dict,  # Add user-defined symbols
        }

        # Execute with restricted namespace
        result = eval(code, {"__builtins__": {}}, safe_namespace)

        return {'data': str(result), 'error': ''}

    except Exception as e:
        return {'data': '', 'error': f"Python execution error: {str(e)}"}


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=7395)
